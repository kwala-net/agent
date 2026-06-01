# Trader Agent — Claude Code Context

## What this project is

A 24/7 autonomous crypto trading agent on Polygon (chainId 137). Kwala runs four on-chain workflows autonomously. The agent server (Express/TypeScript) receives webhooks from Kwala, calls a pluggable LLM for decisions, and writes all trade state back to a Solidity contract (`TraderAgent.sol`) that acts as the on-chain database.

## Commands

```bash
npm run dev              # start server with ts-node (development)
npm run build            # tsc → dist/
npm start                # run compiled output
npm run deploy:contract  # deploy TraderAgent.sol to Polygon
```

Node.js ≥ 18 required. TypeScript 4.9 targeting ES2019/CommonJS.

## Key design decisions

**No Redis.** All trade state lives in `TraderAgent.sol` on Polygon. `src/memory.ts` reads from the contract via ethers view calls. Price observations and LLM reasoning strings are kept in in-memory circular buffers inside `memory.ts` (they are ephemeral and high-frequency — storing them on-chain would cost significant gas).

**Contract is the DB.** `TraderAgent.sol` stores every trade as a `Trade` struct with full data: token, amount, entry/exit price in USD×1e8, P&L in cents, timestamps, status enum, confidence (0–100), and LLM reasoning string. The contract has `getRecentTrades(n)` and `getOpenTrade(token)` view functions the server reads from.

**Direction enum, not bool.** The contract uses `enum Direction { BUY, SELL, HOLD }`. BUY opens a position (`openTrade()` → emits `BuySignal`). SELL closes it (`emitSell()` → emits `SellSignal`). These are separate events so Kwala can use different Uniswap function signatures (buy = `swapExactETHForTokens`, sell = `swapExactTokensForETH`).

**Pluggable LLM.** `src/llm.ts` is a factory. It reads `LLM_PROVIDER` env var (`custom` by default, `anthropic` opt-in) and delegates to `src/providers/custom.ts` or `src/providers/anthropic.ts`. Both export the same `getTradeDecision(...)` signature. The custom provider POSTs the context payload to `CUSTOM_LLM_URL` with no auth headers and expects `LLMDecision` JSON back.

**Owner-only contract writes.** `PRIVATE_KEY` in `.env` is the deployer EOA. Only it can call `openTrade`, `emitSell`, `closeTrade`. This is NOT the Kwala smart wallet — that wallet only executes Uniswap swaps.

**Kwala does all swaps.** The server never signs swap transactions. It only calls the three owner functions above. Kwala listens for `BuySignal`/`SellSignal` events and executes the actual swaps via its smart wallet.

## File map

| File | Role |
|---|---|
| `src/server.ts` | Express app. Four routes: `/observe` (price update), `/trade-fired` (swap submitted), `/outcome` (swap settled), `/status` (health). All handlers wrapped in try/catch; returns 500 on error so Kwala retries. |
| `src/llm.ts` | Provider factory. Reads `LLM_PROVIDER`, delegates to provider module, catches errors and returns safe `HOLD`. |
| `src/providers/custom.ts` | Default LLM provider. POSTs context to `CUSTOM_LLM_URL` via axios, no auth. |
| `src/providers/anthropic.ts` | Anthropic provider. Uses `claude-opus-4-6`, 256 max tokens, JSON-only system prompt. |
| `src/memory.ts` | Contract read layer (`getRecentTrades`, `findOpenTrade`) + in-memory buffers for prices and reasoning. |
| `src/kwala.ts` | Contract write layer. `openTrade()`, `emitSell()`, `closeTrade()` — all use ethers v6, read from env. |
| `src/portfolio.ts` | Fetches ETH balance (via RPC) and USDC balance (via ERC-20 `balanceOf` on `0x2791...`). ETH price from CoinGecko. |
| `src/types.ts` | Shared interfaces: `Trade`, `LLMDecision`, `MarketObservation`, `Portfolio`, Kwala payload types. |
| `contracts/TraderAgent.sol` | On-chain trade DB. Solidity 0.8.20. |
| `scripts/deploy.ts` | Deploys `TraderAgent.sol`. Requires bytecode to be pasted in after compiling. |
| `kwala/*.yaml` | Kwala workflow configs. Not code — deployed via Kwala dashboard or MCP. |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `custom` | `custom` or `anthropic` |
| `CUSTOM_LLM_URL` | — | Required when `LLM_PROVIDER=custom` |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `POLYGON_RPC_URL` | — | Polygon mainnet RPC |
| `PRIVATE_KEY` | — | Deployer EOA (not Kwala smart wallet) |
| `TRADERAGENT_CONTRACT_ADDRESS` | — | Set after `npm run deploy:contract` |
| `KWALA_SMART_WALLET` | — | Kwala smart wallet address |
| `PORT` | `3000` | Express listen port |

## Kwala workflow summary

| Workflow file | Trigger event | Action |
|---|---|---|
| `trader-observe.yaml` | ETH/USD oracle price update | POST to `/observe` |
| `trader-execute-buy.yaml` | `BuySignal(uint256,address,uint256,uint256)` | `swapExactETHForTokens` on Uniswap V2, POST to `/trade-fired` |
| `trader-execute-sell.yaml` | `SellSignal(uint256,address,uint256,uint256)` | `swapExactTokensForETH` on Uniswap V2, POST to `/trade-fired` |
| `trader-outcome.yaml` | Token movement on Kwala smart wallet | POST to `/outcome` |

All workflows target chainId 137 (Polygon mainnet). `re.event(N)` in YAML params maps to positional event arguments (including indexed ones).

## Contract addresses (Polygon mainnet)

- Uniswap V2 Router: `0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff`
- WETH: `0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619`
- USDC: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`

## Adding a new LLM provider

1. Create `src/providers/<name>.ts` exporting:
   ```typescript
   export async function getTradeDecision(
     market: MarketObservation,
     portfolio: Portfolio,
     recentTrades: Trade[],
     recentPrices: number[],
     recentReasoning: string[]
   ): Promise<LLMDecision>
   ```
2. Add it to the `PROVIDERS` map in `src/llm.ts`
3. Add `LLM_PROVIDER=<name>` as a valid value in `.env.example`

## Trade lifecycle

```
openTrade() called by server
  → status: OPEN, BuySignal emitted
  → Kwala executes buy swap

emitSell() called by server
  → status: PENDING_CLOSE, SellSignal emitted
  → Kwala executes sell swap

/outcome webhook received from Kwala address tracker
  → closeTrade() called by server
  → status: CLOSED, exitPrice + pnlUsdCents written on-chain
```
