import { ethers } from 'ethers';
import { KwalaTradeFirePayload, TradeAction } from './types';

const DIRECTION: Record<TradeAction, number> = { BUY: 0, SELL: 1, HOLD: 2 };

const ABI = [
  // write
  'function updatePrice(uint256 newPrice) external',
  'function recordRound(string token, uint256 price, uint256 ethBalanceWei, uint256 usdcBalance, uint256 totalValueUsd, uint8 action, uint256 amountWei, uint8 confidence, string reasoning) external returns (uint256)',
  'function openTrade(uint256 roundId, address token, uint256 amountWei, uint256 entryPrice, uint8 confidence, string reasoning) external returns (uint256)',
  'function emitSell(uint256 tradeId) external',
  'function closeTrade(uint256 tradeId, uint256 exitPrice, int256 pnlUsdCents) external',
  // events
  'event PriceUpdated(uint256 indexed oldPrice, uint256 indexed newPrice)',
  'event RoundRecorded(uint256 indexed roundId, uint8 indexed action, uint256 price)',
  'event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
  'event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
];

const iface = new ethers.Interface(ABI);

let _signer: ethers.Wallet | null = null;
let _contract: ethers.Contract | null = null;

function contract(): ethers.Contract {
  if (!_contract) {
    const provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL!);
    _signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    _contract = new ethers.Contract(
      process.env.TRADERAGENT_CONTRACT_ADDRESS!,
      ABI,
      _signer
    );
  }
  return _contract;
}

function parseEvent(logs: readonly ethers.Log[], name: string): ethers.LogDescription | null {
  for (const log of logs) {
    try {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === name) return parsed;
    } catch { /* skip unrelated logs */ }
  }
  return null;
}

/// Stores the latest BTC price on-chain and emits PriceUpdated.
/// Called by /api/updateprice (triggered by the trader-price-oracle Kwala workflow).
export async function updatePrice(rawPrice: bigint): Promise<void> {
  console.log(`[kwala] updatePrice raw=${rawPrice}`);
  const tx = await contract().updatePrice(rawPrice);
  const receipt = await tx.wait();
  console.log(`[kwala] PriceUpdated tx=${receipt.hash}`);
}

/// Records one full observe→decide cycle on-chain.
/// Returns the on-chain roundId.
export async function recordRound(
  token: string,
  priceUsd: number,
  ethBalanceWei: string,
  usdcBalance: number,
  totalValueUsd: number,
  action: TradeAction,
  amountWei: bigint,
  confidence: number,
  reasoning: string
): Promise<number> {
  const priceRaw     = BigInt(Math.round(priceUsd * 1e8));
  const usdcRaw      = BigInt(Math.round(usdcBalance * 1e6));
  const totalRaw     = BigInt(Math.round(totalValueUsd * 1e8));
  const confidencePct = Math.min(100, Math.round(confidence * 100));
  const actionEnum   = DIRECTION[action];

  console.log(`[kwala] recordRound token=${token} price=${priceUsd} action=${action}`);

  const tx = await contract().recordRound(
    token, priceRaw, BigInt(ethBalanceWei), usdcRaw, totalRaw,
    actionEnum, amountWei, confidencePct, reasoning
  );
  const receipt = await tx.wait();

  const evt = parseEvent(receipt.logs, 'RoundRecorded');
  if (!evt) throw new Error(`[kwala] RoundRecorded event not found in tx ${receipt.hash}`);
  const roundId = Number(evt.args.roundId);

  console.log(`[kwala] RoundRecorded roundId=${roundId} tx=${receipt.hash}`);
  return roundId;
}

/// Opens a BUY position linked to a round; emits BuySignal for Kwala.
export async function openTrade(
  roundId: number,
  token: string,
  amountWei: bigint,
  entryPriceUsd: number,
  confidence: number,
  reasoning: string
): Promise<{ tradeId: number; txHash: string }> {
  const entryPrice    = BigInt(Math.round(entryPriceUsd * 1e8));
  const confidencePct = Math.min(100, Math.round(confidence * 100));

  console.log(`[kwala] openTrade roundId=${roundId} token=${token} price=${entryPriceUsd}`);

  const tx = await contract().openTrade(roundId, token, amountWei, entryPrice, confidencePct, reasoning);
  const receipt = await tx.wait();

  const evt = parseEvent(receipt.logs, 'BuySignal');
  const tradeId = evt ? Number(evt.args.tradeId) : 0;

  console.log(`[kwala] BuySignal mined tradeId=${tradeId} tx=${receipt.hash}`);
  return { tradeId, txHash: receipt.hash as string };
}

/// Marks the trade pending-close; emits SellSignal for Kwala.
export async function emitSell(tradeId: number): Promise<string> {
  console.log(`[kwala] emitSell tradeId=${tradeId}`);
  const tx = await contract().emitSell(tradeId);
  const receipt = await tx.wait();
  console.log(`[kwala] SellSignal mined tradeId=${tradeId} tx=${receipt.hash}`);
  return receipt.hash as string;
}

/// Writes the final exit price and P&L to the on-chain trade record.
export async function closeTrade(
  tradeId: number,
  exitPriceUsd: number,
  pnlUsd: number
): Promise<void> {
  const exitPrice = BigInt(Math.round(exitPriceUsd * 1e8));
  const pnlCents  = BigInt(Math.round(pnlUsd * 100));

  console.log(`[kwala] closeTrade tradeId=${tradeId} exit=${exitPriceUsd} pnl=${pnlUsd.toFixed(2)}`);
  const tx = await contract().closeTrade(tradeId, exitPrice, pnlCents);
  await tx.wait();
  console.log(`[kwala] closeTrade confirmed tradeId=${tradeId}`);
}

export function acknowledgeKwalaFired(payload: KwalaTradeFirePayload): void {
  console.log(
    `[kwala] swap confirmed — tradeId=${payload.tradeId} direction=${payload.direction} token=${payload.token} status=${payload.status}`
  );
}
