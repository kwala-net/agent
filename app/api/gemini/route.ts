import { NextRequest, NextResponse } from 'next/server';
import type { LLMDecision, MarketObservation, Portfolio, Trade } from '@/src/types';
import { getTradeDecision } from '@/src/providers/gemini';

// Proxy route for the Gemini provider.
// Accepts the same payload as /api/llm so it can be used as CUSTOM_LLM_URL.
// The GEMINI_API_KEY stays server-side — callers need no auth headers.

interface RequestBody {
  market: MarketObservation & { current_price_usd: number };
  portfolio: Omit<Portfolio, 'eth_balance_wei'>;
  recent_trades: Trade[];
  last_n_prices: number[];
  llm_reasoning_history: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { market, portfolio, recent_trades, last_n_prices, llm_reasoning_history } = body;

    const normalizedMarket: MarketObservation = {
      token: market.token,
      price: market.current_price_usd ?? market.price,
      timestamp: market.timestamp,
      chain: market.chain,
    };

    const normalizedPortfolio: Portfolio = {
      eth_balance: portfolio.eth_balance,
      eth_balance_wei: '0',
      usdc_balance: portfolio.usdc_balance,
      total_value_usd: portfolio.total_value_usd,
    };

    const decision: LLMDecision = await getTradeDecision(
      normalizedMarket,
      normalizedPortfolio,
      recent_trades,
      last_n_prices,
      llm_reasoning_history
    );

    return NextResponse.json(decision);
  } catch (err) {
    console.error('[api/gemini] error:', err);
    return NextResponse.json(
      { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: 'internal error' },
      { status: 500 }
    );
  }
}
