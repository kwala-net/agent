import { ethers } from 'ethers';
import { Trade, MarketObservation } from './types';

// ── contract read layer ───────────────────────────────────────────────────────

const ABI = [
  'function tradesCount() view returns (uint256)',
  'function getRecentTrades(uint256 n) view returns (tuple(uint256 id, address token, uint256 amountWei, uint256 entryPrice, uint256 exitPrice, int256 pnlUsdCents, uint256 openedAt, uint256 closedAt, uint8 status, uint8 confidence, string reasoning)[])',
  'function getOpenTrade(address token) view returns (bool exists, tuple(uint256 id, address token, uint256 amountWei, uint256 entryPrice, uint256 exitPrice, int256 pnlUsdCents, uint256 openedAt, uint256 closedAt, uint8 status, uint8 confidence, string reasoning) trade)',
];

// Direction enum: 0=BUY 1=SELL 2=HOLD
// Status enum:    0=OPEN 1=PENDING_CLOSE 2=CLOSED 3=FAILED
const ACTIONS = ['BUY', 'SELL', 'HOLD'] as const;
const STATUSES = ['open', 'pending_close', 'closed', 'failed'] as const;

let _provider: ethers.JsonRpcProvider | null = null;
let _contract: ethers.Contract | null = null;

function contract(): ethers.Contract {
  if (!_contract) {
    _provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL!);
    _contract = new ethers.Contract(
      process.env.TRADERAGENT_CONTRACT_ADDRESS!,
      ABI,
      _provider
    );
  }
  return _contract;
}

function fromChain(raw: any): Trade {
  const statusIdx = Number(raw.status);
  const status = STATUSES[statusIdx] ?? 'failed';

  // Trades are always opened as BUY positions; status distinguishes open vs closed
  const action = status === 'closed' ? 'SELL' : 'BUY';

  return {
    id: raw.id.toString(),
    action,
    token: raw.token,
    amount_eth: parseFloat(ethers.formatEther(raw.amountWei)),
    entry_price: Number(raw.entryPrice) / 1e8,
    exit_price: raw.exitPrice > 0n ? Number(raw.exitPrice) / 1e8 : null,
    pnl_usd: raw.pnlUsdCents !== 0n ? Number(raw.pnlUsdCents) / 100 : null,
    timestamp: Number(raw.openedAt),
    status,
    tx_hash: null,
    llm_reasoning: raw.reasoning,
    confidence: Number(raw.confidence) / 100,
  };
}

export async function getRecentTrades(n = 20): Promise<Trade[]> {
  const raws: any[] = await contract().getRecentTrades(n);
  return raws.map(fromChain).reverse(); // newest first
}

export async function findOpenTrade(token: string): Promise<Trade | null> {
  const [exists, raw] = await contract().getOpenTrade(token);
  if (!exists) return null;
  return fromChain(raw);
}

// ── in-memory circular buffers (prices & reasoning are ephemeral) ─────────────

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
