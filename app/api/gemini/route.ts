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

const CTRL_ESCAPES: Record<string, string> = {
  '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f',
};

function sanitizeJson(raw: string): string {
  // Escape bare control characters inside JSON string literals.
  // Structural whitespace (between tokens) is left untouched.
  return raw.replace(/"((?:[^"\\]|\\.)*)"/g, (match) =>
    match.replace(/[\x00-\x1f]/g, (c) => CTRL_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = JSON.parse(sanitizeJson(await request.text())) as RequestBody;
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
      recent_trades ?? [],
      last_n_prices ?? [],
      llm_reasoning_history ?? []
    );

    return NextResponse.json(decision);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/gemini] error:', err);
    return NextResponse.json(
      { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: `gemini error: ${msg}` }
    );
  }
}
