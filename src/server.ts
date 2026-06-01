import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ethers } from 'ethers';

import * as memory from './memory';
import * as portfolio from './portfolio';
import * as llm from './llm';
import * as kwala from './kwala';
import { KwalaObservePayload, KwalaOutcomePayload, KwalaTradeFirePayload } from './types';

// WETH on Polygon — used as the tokenAddress in all ETH trade signals
const WETH = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';

const app = express();
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ── schemas ───────────────────────────────────────────────────────────────────

const ObserveSchema = z.object({
  signal: z.string(),
  token: z.string(),
  price: z.string(),
  timestamp: z.string(),
});

const OutcomeSchema = z.object({
  wallet: z.string(),
  token: z.string(),
  amount: z.string(),
  tx_hash: z.string(),
  signal: z.string(),
});

const TradeFiredSchema = z.object({
  tradeId: z.string(),
  token: z.string(),
  amount: z.string(),
  direction: z.string(),
  status: z.string(),
});

// ── routes ────────────────────────────────────────────────────────────────────

// POST /observe — Kwala workflow 1 (price oracle)
app.post('/observe', async (req: Request, res: Response) => {
  try {
    const payload = ObserveSchema.parse(req.body) as KwalaObservePayload;
    const price = parseFloat(payload.price);
    const timestamp = parseInt(payload.timestamp, 10);

    const market = { token: payload.token, price, timestamp, chain: 'polygon' };
    await memory.saveObservation(market);

    const [port, recentTrades, recentPrices, recentReasoning] = await Promise.all([
      portfolio.getPortfolio(process.env.KWALA_SMART_WALLET!),
      memory.getRecentTrades(20),
      memory.getRecentPrices(payload.token, 6),
      memory.getRecentReasoning(5),
    ]);

    const decision = await llm.getTradeDecision(market, port, recentTrades, recentPrices, recentReasoning);
    await memory.saveReasoning(decision.reasoning);

    console.log(
      `[observe] ETH=$${price} → ${decision.action} confidence=${decision.confidence} | ${decision.reasoning}`
    );

    if (decision.action === 'BUY') {
      const existing = await memory.findOpenTrade(WETH);
      if (existing) {
        console.log(`[observe] BUY skipped — open trade already exists id=${existing.id}`);
      } else {
        const amountWei = ethers.parseEther(decision.amount_eth.toString());
        await kwala.openTrade(WETH, amountWei, price, decision.confidence, decision.reasoning);
      }
    } else if (decision.action === 'SELL') {
      const open = await memory.findOpenTrade(WETH);
      if (open) {
        await kwala.emitSell(Number(open.id));
      } else {
        console.log('[observe] SELL skipped — no open trade found');
      }
    }
    // HOLD: observation already saved above; nothing else to do

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[observe] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /trade-fired — Kwala workflow 2 (buy) or 3 (sell), confirming swap submitted
app.post('/trade-fired', async (req: Request, res: Response) => {
  try {
    const payload = TradeFiredSchema.parse(req.body) as KwalaTradeFirePayload;
    kwala.acknowledgeKwalaFired(payload);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[trade-fired] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// POST /outcome — Kwala workflow 4 (address tracking), settlement confirmed
app.post('/outcome', async (req: Request, res: Response) => {
  try {
    const payload = OutcomeSchema.parse(req.body) as KwalaOutcomePayload;

    const open = await memory.findOpenTrade(payload.token);
    if (open) {
      const exitPrice = await portfolio.getEthPrice();
      const pnlUsd = (exitPrice - open.entry_price) * open.amount_eth;
      await kwala.closeTrade(Number(open.id), exitPrice, pnlUsd);
      console.log(
        `[outcome] trade ${open.id} closed — entry=$${open.entry_price} exit=$${exitPrice} pnl=$${pnlUsd.toFixed(2)}`
      );
    } else {
      console.log(`[outcome] no open trade found for token=${payload.token}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[outcome] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /status — health check
app.get('/status', async (_req: Request, res: Response) => {
  try {
    const [recentTrades, recentPrices] = await Promise.all([
      memory.getRecentTrades(5),
      memory.getRecentPrices('ETH', 6),
    ]);

    const openTrades = recentTrades.filter(
      (t) => t.status === 'open' || t.status === 'pending_close'
    );

    res.status(200).json({ status: 'ok', recentTrades, recentPrices, openTrades });
  } catch (err) {
    console.error('[status] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
app.listen(PORT, () => {
  console.log(`[server] trader-agent listening on port ${PORT}`);
});

export default app;
