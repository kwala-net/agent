import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ethers } from 'ethers';
import * as memory from '@/src/memory';
import * as portfolio from '@/src/portfolio';
import * as llm from '@/src/llm';
import * as kwala from '@/src/kwala';

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

const ObserveSchema = z.object({
  signal: z.string().optional(),
  token: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = ObserveSchema.parse(await request.json());
    const token = payload.token ?? 'BTC';

    // Fetch BTC/USD price directly from Chainlink on Sepolia
    const price = await portfolio.getBtcPrice();
    const timestamp = Math.floor(Date.now() / 1000);

    const market = { token, price, timestamp, chain: 'eth-sepolia' };
    await memory.saveObservation(market);

    const [port, recentTrades, recentPrices, recentReasoning] = await Promise.all([
      portfolio.getPortfolio(process.env.KWALA_SMART_WALLET!),
      memory.getRecentTrades(20),
      memory.getRecentPrices(token, 6),
      memory.getRecentReasoning(5),
    ]);

    const decision = await llm.getTradeDecision(market, port, recentTrades, recentPrices, recentReasoning);
    await memory.saveReasoning(decision.reasoning);

    console.log(`[observe] ${token}=$${price.toFixed(2)} → ${decision.action} confidence=${decision.confidence} | ${decision.reasoning}`);

    const amountWei = decision.action === 'BUY'
      ? ethers.parseEther(decision.amount_eth.toString())
      : 0n;

    const roundId = await kwala.recordRound(
      token,
      price,
      port.eth_balance_wei,
      port.usdc_balance,
      port.total_value_usd,
      decision.action,
      amountWei,
      decision.confidence,
      decision.reasoning,
    );

    if (decision.action === 'BUY') {
      const existing = await memory.findOpenTrade(WETH);
      if (existing) {
        console.log(`[observe] BUY skipped — open trade already exists id=${existing.id}`);
      } else {
        await kwala.openTrade(roundId, WETH, amountWei, price, decision.confidence, decision.reasoning);
      }
    } else if (decision.action === 'SELL') {
      const open = await memory.findOpenTrade(WETH);
      if (open && open.status === 'open') {
        await kwala.emitSell(Number(open.id));
      } else if (open) {
        console.log(`[observe] SELL skipped — trade id=${open.id} already ${open.status}`);
      } else {
        console.log('[observe] SELL skipped — no open trade found');
      }
    }

    return NextResponse.json({ received: true, roundId });
  } catch (err) {
    console.error('[observe] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
