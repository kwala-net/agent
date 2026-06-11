import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import * as kwala from '@/src/kwala';

const UpdatePriceSchema = z.object({
  signal: z.string().optional(),
  price: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const payload = UpdatePriceSchema.parse(await request.json());

    // Chainlink latestAnswer is an int256 integer string — convert directly to bigint
    const rawPrice = BigInt(Math.round(parseFloat(payload.price)));

    console.log(`[updateprice] raw=${payload.price} parsed=${rawPrice}`);

    await kwala.updatePrice(rawPrice);

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[updateprice] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
