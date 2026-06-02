import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ethers } from 'ethers';
import * as memory from '@/src/memory';
import * as portfolio from '@/src/portfolio';
import * as llm from '@/src/llm';
import * as kwala from '@/src/kwala';

const WETH = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';

const ObserveSchema = z.object({
  signal: z.string(),
  token: z.string(),
  price: z.string(),
  timestamp: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = ObserveSchema.parse(await request.json());
    const price = parseFloat(payload.price);
    const timestamp = parseInt(payload.timestamp, 10);

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

    console.log(`[observe] ETH=$${price} → ${decision.action} confidence=${decision.confidence} | ${decision.reasoning}`);

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

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[observe] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
