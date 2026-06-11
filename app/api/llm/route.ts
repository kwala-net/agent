import { NextRequest, NextResponse } from 'next/server';
import type { LLMDecision, MarketObservation, Portfolio, Trade } from '@/src/types';

// Built-in momentum strategy — replace this logic to customise the trading behaviour.
// The observe route calls this via the custom provider when CUSTOM_LLM_URL points here.

interface RequestBody {
  market: MarketObservation & { current_price_usd: number };
  // eth_balance_wei is not sent by providers — it's only used for contract writes
  portfolio: Omit<Portfolio, 'eth_balance_wei'>;
  recent_trades: Trade[];
  last_n_prices: number[];
  llm_reasoning_history: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    const { market, portfolio } = body;
    const recent_trades = body.recent_trades ?? [];
    const last_n_prices = body.last_n_prices ?? [];

    const price = market.current_price_usd ?? market.price;
    const prices = [price, ...last_n_prices].filter(Boolean);

    const openTrade = recent_trades.find(
      (t) => t.status === 'open' || t.status === 'pending_close'
    );

    let decision: LLMDecision;

    if (openTrade) {
      const changePct = (price - openTrade.entry_price) / openTrade.entry_price;

      if (changePct <= -0.02) {
        decision = {
          action: 'SELL',
          token: 'ETH',
          amount_eth: openTrade.amount_eth,
          confidence: 0.85,
          reasoning: `Stop-loss: price dropped ${(changePct * 100).toFixed(1)}% from entry $${openTrade.entry_price.toFixed(0)}`,
        };
      } else if (changePct >= 0.03) {
        decision = {
          action: 'SELL',
          token: 'ETH',
          amount_eth: openTrade.amount_eth,
          confidence: 0.8,
          reasoning: `Take-profit: price up ${(changePct * 100).toFixed(1)}% from entry $${openTrade.entry_price.toFixed(0)}`,
        };
      } else {
        decision = {
          action: 'HOLD',
          token: 'ETH',
          amount_eth: 0,
          confidence: 0.6,
          reasoning: `Holding — entry $${openTrade.entry_price.toFixed(0)}, current $${price.toFixed(0)} (${(changePct * 100).toFixed(1)}%)`,
        };
      }
    } else {
      const maxBuyEth = Math.min(
        portfolio.eth_balance * 0.1,
        (portfolio.total_value_usd * 0.1) / price
      );

      if (prices.length >= 3) {
        const rising = prices[0] > prices[1] && prices[1] > prices[2];
        const falling = prices[0] < prices[1] && prices[1] < prices[2];

        if (rising && maxBuyEth > 0.001) {
          decision = {
            action: 'BUY',
            token: 'ETH',
            amount_eth: parseFloat(maxBuyEth.toFixed(4)),
            confidence: 0.65,
            reasoning: `Upward momentum: $${prices[2].toFixed(0)} → $${prices[1].toFixed(0)} → $${prices[0].toFixed(0)}`,
          };
        } else if (falling) {
          decision = {
            action: 'HOLD',
            token: 'ETH',
            amount_eth: 0,
            confidence: 0.7,
            reasoning: `Downward momentum, waiting for reversal: $${prices[2].toFixed(0)} → $${prices[1].toFixed(0)} → $${prices[0].toFixed(0)}`,
          };
        } else {
          decision = {
            action: 'HOLD',
            token: 'ETH',
            amount_eth: 0,
            confidence: 0.5,
            reasoning: `No clear momentum signal at $${price.toFixed(0)}`,
          };
        }
      } else {
        decision = {
          action: 'HOLD',
          token: 'ETH',
          amount_eth: 0,
          confidence: 0.5,
          reasoning: `Collecting price history (${prices.length} ticks so far)`,
        };
      }
    }

    return NextResponse.json(decision);
  } catch (err) {
    console.error('[llm] error:', err);
    return NextResponse.json(
      { action: 'HOLD', token: 'ETH', amount_eth: 0, confidence: 0, reasoning: 'internal error' },
      { status: 500 }
    );
  }
}
