import axios from 'axios';
import { LLMDecision, MarketObservation, Portfolio, Trade } from '../types';

// Default provider — POSTs the context payload to CUSTOM_LLM_URL and expects
// an LLMDecision JSON back. No authentication headers are sent.
//
// Your endpoint receives:
//   POST <CUSTOM_LLM_URL>
//   Content-Type: application/json
//   { market, portfolio, recent_trades, last_n_prices, llm_reasoning_history }
//
// It must respond with:
//   { "action": "BUY"|"SELL"|"HOLD", "token": "ETH",
//     "amount_eth": <number>, "confidence": <0-1>, "reasoning": "<string>" }

export async function getTradeDecision(
  market: MarketObservation,
  portfolio: Portfolio,
  recentTrades: Trade[],
  recentPrices: number[],
  recentReasoning: string[]
): Promise<LLMDecision> {
  const url = process.env.CUSTOM_LLM_URL;
  if (!url) throw new Error('CUSTOM_LLM_URL is not set');

  const payload = {
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
  };

  const resp = await axios.post<LLMDecision>(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15_000,
  });

  return resp.data;
}
