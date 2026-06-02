import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as memory from '@/src/memory';
import * as portfolio from '@/src/portfolio';
import * as kwala from '@/src/kwala';

const OutcomeSchema = z.object({
  wallet: z.string(),
  token: z.string(),
  amount: z.string(),
  tx_hash: z.string(),
  signal: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = OutcomeSchema.parse(await request.json());

    const open = await memory.findOpenTrade(payload.token);
    if (open) {
      const exitPrice = await portfolio.getEthPrice();
      const pnlUsd = (exitPrice - open.entry_price) * open.amount_eth;
      await kwala.closeTrade(Number(open.id), exitPrice, pnlUsd);
      console.log(`[outcome] trade ${open.id} closed — entry=$${open.entry_price} exit=$${exitPrice} pnl=$${pnlUsd.toFixed(2)}`);
    } else {
      console.log(`[outcome] no open trade found for token=${payload.token}`);
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[outcome] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
