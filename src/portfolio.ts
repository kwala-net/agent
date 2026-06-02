import { ethers } from 'ethers';
import { Portfolio } from './types';

// Sepolia addresses
const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ETH_USD_FEED = '0x694AA1769357215DE4FAC081bf1f309aDC325306';

const USDC_ABI = ['function balanceOf(address) view returns (uint256)'];
const CHAINLINK_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(process.env.ETH_SEPOLIA_RPC_URL!);
  }
  return provider;
}

export async function getEthPrice(): Promise<number> {
  const p = getProvider();
  const feed = new ethers.Contract(ETH_USD_FEED, CHAINLINK_ABI, p);
  const [, answer] = await feed.latestRoundData();
  return Number(answer) / 1e8;
}

export async function getPortfolio(walletAddress: string): Promise<Portfolio> {
  const p = getProvider();

  const [rawEth, usdc, ethPrice] = await Promise.all([
    p.getBalance(walletAddress),
    new ethers.Contract(USDC_ADDRESS, USDC_ABI, p)
      .balanceOf(walletAddress)
      .then((b: bigint) => Number(ethers.formatUnits(b, 6))),
    getEthPrice(),
  ]);

  const eth_balance = parseFloat(ethers.formatEther(rawEth));
  const total_value_usd = eth_balance * ethPrice + usdc;

  return { eth_balance, usdc_balance: usdc, total_value_usd };
}
