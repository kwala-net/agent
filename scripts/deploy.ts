import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// ABI for TraderAgent.sol — matches contracts/TraderAgent.sol exactly.
const ABI = [
  'constructor()',
  'function openTrade(address token, uint256 amountWei, uint256 entryPrice, uint8 confidence, string reasoning) external returns (uint256)',
  'function emitSell(uint256 tradeId) external',
  'function closeTrade(uint256 tradeId, uint256 exitPrice, int256 pnlUsdCents) external',
  'function getRecentTrades(uint256 n) view returns (tuple(uint256 id, address token, uint256 amountWei, uint256 entryPrice, uint256 exitPrice, int256 pnlUsdCents, uint256 openedAt, uint256 closedAt, uint8 status, uint8 confidence, string reasoning)[])',
  'function getOpenTrade(address token) view returns (bool exists, tuple(uint256 id, address token, uint256 amountWei, uint256 entryPrice, uint256 exitPrice, int256 pnlUsdCents, uint256 openedAt, uint256 closedAt, uint8 status, uint8 confidence, string reasoning) trade)',
  'function tradesCount() view returns (uint256)',
  'function owner() view returns (address)',
  'event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
  'event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice)',
  'event TradeClosed(uint256 indexed tradeId, uint256 exitPrice, int256 pnlUsdCents)',
];

// Bytecode must come from compiling contracts/TraderAgent.sol.
//
// Quick compilation options:
//   Option A — solc (install globally: npm i -g solc)
//     solcjs --bin contracts/TraderAgent.sol --output-dir artifacts/
//
//   Option B — Remix IDE
//     Paste TraderAgent.sol → compile → copy bytecode from Compilation Details
//
//   Option C — Foundry
//     forge build
//     cat out/TraderAgent.sol/TraderAgent.json | jq -r '.bytecode.object'
//
// Paste the resulting 0x... hex string below:
const BYTECODE = '0x'; // REPLACE with compiled bytecode before running

async function main() {
  if (BYTECODE === '0x') {
    console.error(
      'ERROR: BYTECODE is not set.\n' +
      'Compile contracts/TraderAgent.sol and paste the bytecode into scripts/deploy.ts.\n' +
      'See the comments above BYTECODE for compilation options.'
    );
    process.exit(1);
  }

  const privateKey = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.ETH_SEPOLIA_RPC_URL;
  if (!privateKey) throw new Error('PRIVATE_KEY not set in .env');
  if (!rpcUrl) throw new Error('ETH_SEPOLIA_RPC_URL not set in .env');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const network = await provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  const factory = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  console.log('Deploying TraderAgent...');

  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nTraderAgent deployed at: ${address}`);
  console.log(`\nAdd to .env:`);
  console.log(`TRADERAGENT_CONTRACT_ADDRESS=${address}`);
  console.log(`\nAdd to kwala/trader-execute-buy.yaml and kwala/trader-execute-sell.yaml:`);
  console.log(`  TriggerSourceContract: "${address}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
