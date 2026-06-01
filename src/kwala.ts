import { ethers } from 'ethers';
import { KwalaTradeFirePayload } from './types';

const ABI = [
  'function openTrade(address token, uint256 amountWei, uint256 entryPrice, uint8 confidence, string reasoning) external returns (uint256)',
  'function emitSell(uint256 tradeId) external',
  'function closeTrade(uint256 tradeId, uint256 exitPrice, int256 pnlUsdCents) external',
  'event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
  'event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
];

const iface = new ethers.Interface(ABI);

let _signer: ethers.Wallet | null = null;
let _contract: ethers.Contract | null = null;

function contract(): ethers.Contract {
  if (!_contract) {
    const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL!);
    _signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);
    _contract = new ethers.Contract(
      process.env.TRADERAGENT_CONTRACT_ADDRESS!,
      ABI,
      _signer
    );
  }
  return _contract;
}

/// Opens a BUY position on-chain; emits BuySignal for Kwala to execute the swap.
export async function openTrade(
  token: string,
  amountWei: bigint,
  entryPriceUsd: number,
  confidence: number,
  reasoning: string
): Promise<{ tradeId: number; txHash: string }> {
  const entryPrice = BigInt(Math.round(entryPriceUsd * 1e8));
  const confidencePct = Math.min(100, Math.round(confidence * 100)) as unknown as number;

  console.log(`[kwala] openTrade token=${token} amountWei=${amountWei} price=${entryPriceUsd}`);

  const tx = await contract().openTrade(token, amountWei, entryPrice, confidencePct, reasoning);
  const receipt = await tx.wait();

  let tradeId = 0;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === 'BuySignal') {
        tradeId = Number(parsed.args.tradeId);
        break;
      }
    } catch { /* skip unrelated logs */ }
  }

  console.log(`[kwala] BuySignal mined tradeId=${tradeId} tx=${receipt.hash}`);
  return { tradeId, txHash: receipt.hash as string };
}

/// Marks the trade pending-close on-chain; emits SellSignal for Kwala to execute the swap.
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
  const pnlCents = BigInt(Math.round(pnlUsd * 100));

  console.log(`[kwala] closeTrade tradeId=${tradeId} exit=${exitPriceUsd} pnl=${pnlUsd.toFixed(2)}`);
  const tx = await contract().closeTrade(tradeId, exitPrice, pnlCents);
  await tx.wait();
  console.log(`[kwala] closeTrade confirmed tradeId=${tradeId}`);
}

export function acknowledgeKwalaFired(payload: KwalaTradeFirePayload): void {
  console.log(
    `[kwala] swap confirmed by Kwala — tradeId=${payload.tradeId} direction=${payload.direction} token=${payload.token} status=${payload.status}`
  );
}
