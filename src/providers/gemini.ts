import { GoogleGenAI } from '@google/genai';
import { LLMDecision, MarketObservation, Portfolio, Trade } from '../types';

const SYSTEM_PROMPT = `You are a crypto trading agent managing a DeFi portfolio on Ethereum Sepolia.
You receive BTC price updates from the Chainlink BTC/USD feed on-chain.
You use BTC price momentum to decide when to buy or sell ETH (WETH) on Uniswap V3.
You have access to your recent trade history and outcomes.

Your job: decide whether to BUY, SELL, or HOLD ETH based on the BTC price trend
and your trade history. Think about momentum, recent P&L, and open positions.
Never risk more than 10% of total portfolio value in a single trade.
Never open a new BUY if there is already an open position.

If portfolio is zero, assume portfolio value is 100 USD. If there are no past trades,
take a decision based on the BTC price trend. Try not to say HOLD. Use common trading patterns to make
a BUY or SELL decision ideally.

Respond ONLY with valid JSON — no prose, no markdown fences:
{
  "action": "BUY" | "SELL" | "HOLD",
  "token": "ETH",
  "amount_eth": <number>,
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence max>"
}`;

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

  const response = await client().models.generateContent({
    model: 'gemini-2.5-flash',
    config: { systemInstruction: SYSTEM_PROMPT },
    contents: userMessage,
  });

  const raw = response.text ?? '';

  // Strip markdown fences if the model wraps its response
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Escape raw control characters inside JSON string literals (e.g. bare \n in reasoning)
  const CTRL = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' } as Record<string, string>;
  const sanitized = cleaned.replace(/"((?:[^"\\]|\\.)*)"/g, (match) =>
    match.replace(/[\x00-\x1f]/g, (c) => CTRL[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
  );

  try {
    return JSON.parse(sanitized) as LLMDecision;
  } catch {
    console.error('[gemini] parse error, raw:', raw);
    return { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: 'parse error' };
  }
}
