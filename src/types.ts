export type TradeAction = 'BUY' | 'SELL' | 'HOLD';

export interface LLMDecision {
  action: TradeAction;
  token: string;
  amount_eth: number;
  confidence: number;
  reasoning: string;
}

// Mirrors TraderAgent.sol Round struct (normalized for TypeScript).
export interface Round {
  id: string;
  timestamp: number;         // unix seconds
  token: string;             // price-feed ticker, e.g. "BTC"
  price: number;             // USD (divided by 1e8)
  eth_balance_wei: string;   // Kwala wallet ETH in wei, as string (bigint-safe)
  usdc_balance: number;      // USDC float (divided by 1e6)
  total_value_usd: number;   // USD float (divided by 1e8)
  action: TradeAction;
  amount_eth: number;        // intended trade size
  confidence: number;        // 0.0–1.0
  reasoning: string;
  trade_id: string | null;   // set if trade was opened from this round
  trade_opened: boolean;
}

// Mirrors TraderAgent.sol Trade struct.
export interface Trade {
  id: string;
  round_id: string;           // round that opened this trade
  action: TradeAction;
  token: string;
  amount_eth: number;
  entry_price: number;
  exit_price: number | null;
  pnl_usd: number | null;
  timestamp: number;          // unix seconds (openedAt)
  status: 'open' | 'pending_close' | 'closed' | 'failed';
  tx_hash: string | null;     // not stored on-chain; populated by /trade-fired if needed
  llm_reasoning: string;
  confidence: number;         // 0.0–1.0
}

export interface MarketObservation {
  token: string;
  price: number;
  timestamp: number;
  chain: string;
}

export interface Portfolio {
  eth_balance: number;
  eth_balance_wei: string;   // wei as string for JSON compat + contract calls
  usdc_balance: number;
  total_value_usd: number;
}

export interface KwalaObservePayload {
  signal: string;
  token: string;
  price: string;
  timestamp?: string;
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
