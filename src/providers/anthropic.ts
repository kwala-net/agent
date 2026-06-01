import Anthropic from '@anthropic-ai/sdk';
import { LLMDecision, MarketObservation, Portfolio, Trade } from '../types';

const SYSTEM_PROMPT = `You are a crypto trading agent managing a DeFi portfolio on Polygon.
You receive a market observation every time the ETH price updates on-chain.
You have access to your recent trade history and outcomes.

Your job: decide whether to BUY, SELL, or HOLD ETH based on the current price
and your trade history. Think about momentum, recent P&L, and open positions.
Never risk more than 10% of total portfolio value in a single trade.
Never open a new BUY if there is already an open position.

Respond ONLY with valid JSON — no prose, no markdown fences:
{
  "action": "BUY" | "SELL" | "HOLD",
  "token": "ETH",
  "amount_eth": <number>,
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence max>"
}`;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export async function getTradeDecision(
  market: MarketObservation,
  portfolio: Portfolio,
  recentTrades: Trade[],
  recentPrices: number[],
  recentReasoning: string[]
): Promise<LLMDecision> {
  const userMessage = JSON.stringify({
    market: {
      token: market.token,
      current_price_usd: market.price,
      timestamp: market.timestamp,
      chain: market.chain,
    },
    portfolio: {
      eth_balance: portfolio.eth_balance,
      usdc_balance: portfolio.usdc_balance,
      total_value_usd: portfolio.total_value_usd,
    },
    recent_trades: recentTrades.slice(0, 10),
    last_n_prices: recentPrices.slice(0, 6),
    llm_reasoning_history: recentReasoning.slice(0, 5),
  });

  const response = await client().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = (response.content[0] as { type: string; text: string }).text;

  try {
    return JSON.parse(raw) as LLMDecision;
  } catch {
    console.error('[anthropic] parse error, raw:', raw);
    return { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: 'parse error' };
  }
}
