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
  token: z.string(),
  price: z.string(),
  timestamp: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = ObserveSchema.parse(await request.json());

    // Chainlink latestAnswer is in USD×1e8 (e.g. 6000000000000 = $60000)
    const price = parseFloat(payload.price) / 1e8;
    const timestamp = payload.timestamp
      ? parseInt(payload.timestamp, 10)
      : Math.floor(Date.now() / 1000);

    const market = { token: payload.token, price, timestamp, chain: 'eth-sepolia' };
    await memory.saveObservation(market);

    const [port, recentTrades, recentPrices, recentReasoning] = await Promise.all([
      portfolio.getPortfolio(process.env.KWALA_SMART_WALLET!),
      memory.getRecentTrades(20),
      memory.getRecentPrices(payload.token, 6),
      memory.getRecentReasoning(5),
    ]);

    const decision = await llm.getTradeDecision(market, port, recentTrades, recentPrices, recentReasoning);
    await memory.saveReasoning(decision.reasoning);

    console.log(`[observe] ${payload.token}=$${price.toFixed(2)} → ${decision.action} confidence=${decision.confidence} | ${decision.reasoning}`);

    // Determine trade size for the round record
    const amountWei = decision.action === 'BUY'
      ? ethers.parseEther(decision.amount_eth.toString())
      : 0n;

    // Record the full observe→decide cycle on-chain (every tick, including HOLDs)
    const roundId = await kwala.recordRound(
      payload.token,
      price,
      port.eth_balance_wei,
      port.usdc_balance,
      port.total_value_usd,
      decision.action,
      amountWei,
      decision.confidence,
      decision.reasoning,
    );

    // Act on the decision
    if (decision.action === 'BUY') {
      const existing = await memory.findOpenTrade(WETH);
      if (existing) {
        console.log(`[observe] BUY skipped — open trade already exists id=${existing.id}`);
      } else {
        await kwala.openTrade(roundId, WETH, amountWei, price, decision.confidence, decision.reasoning);
      }
    } else if (decision.action === 'SELL') {
      const open = await memory.findOpenTrade(WETH);
      if (open) {
        await kwala.emitSell(Number(open.id));
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
