import { ethers } from 'ethers';
import { Trade, Round, MarketObservation } from './types';

// ── contract read layer ───────────────────────────────────────────────────────

const ROUND_TUPLE =
  'tuple(uint256 id, uint256 timestamp, string token, uint256 price, uint256 ethBalanceWei, uint256 usdcBalance, uint256 totalValueUsd, uint8 action, uint256 amountWei, uint8 confidence, string reasoning, uint256 tradeId, bool tradeOpened)';

const TRADE_TUPLE =
  'tuple(uint256 id, uint256 roundId, address token, uint256 amountWei, uint256 entryPrice, uint256 exitPrice, int256 pnlUsdCents, uint256 openedAt, uint256 closedAt, uint8 status, uint8 confidence, string reasoning)';

const ABI = [
  `function roundsCount() view returns (uint256)`,
  `function tradesCount() view returns (uint256)`,
  `function getRecentRounds(uint256 n) view returns (${ROUND_TUPLE}[])`,
  `function getRecentTrades(uint256 n) view returns (${TRADE_TUPLE}[])`,
  `function getOpenTrade(address token) view returns (bool exists, ${TRADE_TUPLE} trade)`,
];

const ACTIONS   = ['BUY', 'SELL', 'HOLD'] as const;
const STATUSES  = ['open', 'pending_close', 'closed', 'failed'] as const;

let _provider: ethers.JsonRpcProvider | null = null;
let _contract: ethers.Contract | null = null;

function contract(): ethers.Contract {
  if (!_contract) {
    _provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL!);
    _contract = new ethers.Contract(
      process.env.TRADERAGENT_CONTRACT_ADDRESS!,
      ABI,
      _provider
    );
  }
  return _contract;
}

function fromChainRound(raw: any): Round {
  return {
    id:              raw.id.toString(),
    timestamp:       Number(raw.timestamp),
    token:           raw.token,
    price:           Number(raw.price) / 1e8,
    eth_balance_wei: raw.ethBalanceWei.toString(),
    usdc_balance:    Number(raw.usdcBalance) / 1e6,
    total_value_usd: Number(raw.totalValueUsd) / 1e8,
    action:          ACTIONS[Number(raw.action)] ?? 'HOLD',
    amount_eth:      parseFloat(ethers.formatEther(raw.amountWei)),
    confidence:      Number(raw.confidence) / 100,
    reasoning:       raw.reasoning,
    trade_id:        raw.tradeOpened ? raw.tradeId.toString() : null,
    trade_opened:    raw.tradeOpened,
  };
}

function fromChainTrade(raw: any): Trade {
  const statusIdx = Number(raw.status);
  const status    = STATUSES[statusIdx] ?? 'failed';
  const action    = status === 'closed' ? 'SELL' : 'BUY';

  return {
    id:           raw.id.toString(),
    round_id:     raw.roundId.toString(),
    action,
    token:        raw.token,
    amount_eth:   parseFloat(ethers.formatEther(raw.amountWei)),
    entry_price:  Number(raw.entryPrice) / 1e8,
    exit_price:   raw.exitPrice > 0n ? Number(raw.exitPrice) / 1e8 : null,
    pnl_usd:      raw.pnlUsdCents !== 0n ? Number(raw.pnlUsdCents) / 100 : null,
    timestamp:    Number(raw.openedAt),
    status,
    tx_hash:      null,
    llm_reasoning: raw.reasoning,
    confidence:   Number(raw.confidence) / 100,
  };
}

export async function getRecentRounds(n = 10): Promise<Round[]> {
  const raws: any[] = await contract().getRecentRounds(n);
  return raws.map(fromChainRound).reverse(); // newest first
}

export async function getRecentTrades(n = 20): Promise<Trade[]> {
  const raws: any[] = await contract().getRecentTrades(n);
  return raws.map(fromChainTrade).reverse(); // newest first
}

export async function findOpenTrade(token: string): Promise<Trade | null> {
  const [exists, raw] = await contract().getOpenTrade(token);
  if (!exists) return null;
  return fromChainTrade(raw);
}

// ── in-memory circular buffers (high-frequency ephemeral data) ────────────────

const _prices = new Map<string, number[]>();
const _reasoning: string[] = [];

export async function saveObservation(obs: MarketObservation): Promise<void> {
  const buf = _prices.get(obs.token) ?? [];
  buf.unshift(obs.price);
  if (buf.length > 50) buf.length = 50;
  _prices.set(obs.token, buf);
}

export async function getRecentPrices(token: string, n = 6): Promise<number[]> {
  return (_prices.get(token) ?? []).slice(0, n);
}

export async function saveReasoning(reasoning: string): Promise<void> {
  _reasoning.unshift(reasoning);
  if (_reasoning.length > 10) _reasoning.length = 10;
}

export async function getRecentReasoning(n = 5): Promise<string[]> {
  return _reasoning.slice(0, n);
}
