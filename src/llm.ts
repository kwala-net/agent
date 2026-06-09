import { LLMDecision, MarketObservation, Portfolio, Trade } from './types';
import * as custom from './providers/custom';
import * as anthropic from './providers/anthropic';
import * as gemini from './providers/gemini';

type Provider = 'custom' | 'anthropic' | 'gemini';

function activeProvider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? 'custom').toLowerCase();
  if (p === 'anthropic') return 'anthropic';
  if (p === 'gemini') return 'gemini';
  return 'custom';
}

const PROVIDERS = { custom, anthropic, gemini };

export async function getTradeDecision(
  market: MarketObservation,
  portfolio: Portfolio,
  recentTrades: Trade[],
  recentPrices: number[],
  recentReasoning: string[]
): Promise<LLMDecision> {
  const provider = activeProvider();
  console.log(`[llm] provider=${provider}`);

  try {
    return await PROVIDERS[provider].getTradeDecision(
      market,
      portfolio,
      recentTrades,
      recentPrices,
      recentReasoning
    );
  } catch (err) {
    console.error(`[llm] ${provider} error:`, err);
    return { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: 'provider error' };
  }
}
