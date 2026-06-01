export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export interface LLMDecision {
  action: TradeAction;
  token: string;
  amount_eth: number;
  confidence: number;
  reasoning: string;
}

// Mirrors TraderAgent.sol Trade struct.
// id is the on-chain array index, stored as string for consistency.
export interface Trade {
  id: string;
  action: TradeAction;
  token: string;
  amount_eth: number;
  entry_price: number;
  exit_price: number | null;
  pnl_usd: number | null;
  timestamp: number;           // unix seconds (openedAt)
  status: 'open' | 'pending_close' | 'closed' | 'failed';
  tx_hash: string | null;      // not stored on-chain; populated by /trade-fired if needed
  llm_reasoning: string;
  confidence: number;          // 0.0–1.0
}

export interface MarketObservation {
  token: string;
  price: number;
  timestamp: number;
  chain: string;
}

export interface Portfolio {
  eth_balance: number;
  usdc_balance: number;
  total_value_usd: number;
}

export interface KwalaObservePayload {
  signal: string;
  token: string;
  price: string;
  timestamp: string;
}

export interface KwalaOutcomePayload {
  wallet: string;
  token: string;
  amount: string;
  tx_hash: string;
  signal: string;
}

export interface KwalaTradeFirePayload {
  tradeId: string;
  token: string;
  amount: string;
  direction: string;
  status: string;
}
