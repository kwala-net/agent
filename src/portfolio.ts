import { ethers } from 'ethers';
import axios from 'axios';
import { Portfolio } from './types';

const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDC_ABI = ['function balanceOf(address) view returns (uint256)'];

let provider: ethers.JsonRpcProvider | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL!);
  }
  return provider;
}

export async function getEthPrice(): Promise<number> {
  const resp = await axios.get(
    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    { timeout: 10_000 }
  );
  return resp.data.ethereum.usd as number;
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
