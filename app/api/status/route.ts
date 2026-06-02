import { NextResponse } from 'next/server';
import * as memory from '@/src/memory';
import * as portfolio from '@/src/portfolio';

export async function GET() {
  try {
    const walletAddress = process.env.KWALA_SMART_WALLET;

    const [recentTrades, recentPrices, recentReasoning, port] = await Promise.all([
      memory.getRecentTrades(20),
      memory.getRecentPrices('ETH', 20),
      memory.getRecentReasoning(5),
      walletAddress
        ? portfolio.getPortfolio(walletAddress)
        : Promise.resolve({ eth_balance: 0, usdc_balance: 0, total_value_usd: 0 }),
    ]);

    const openTrades = recentTrades.filter(
      (t) => t.status === 'open' || t.status === 'pending_close'
    );

    return NextResponse.json({
      status: 'ok',
      portfolio: port,
      recentTrades,
      recentPrices,
      openTrades,
      recentReasoning,
    });
  } catch (err) {
    console.error('[status] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
