import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as kwala from '@/src/kwala';

const TradeFiredSchema = z.object({
  tradeId: z.string(),
  token: z.string(),
  amount: z.string(),
  direction: z.string(),
  status: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = TradeFiredSchema.parse(await request.json());
    kwala.acknowledgeKwalaFired(payload);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[trade-fired] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
