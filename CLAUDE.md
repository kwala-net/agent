# Trader Agent — Claude Code Context

## What this project is

A 24/7 autonomous crypto trading agent on Ethereum Sepolia (chainId 11155111). Kwala runs four on-chain workflows autonomously. The Next.js app receives webhooks from Kwala via API routes, calls a pluggable LLM for decisions, renders a live dashboard, and writes all trade state back to a Solidity contract (`TraderAgent.sol`) that acts as the on-chain database.

## Commands

```bash
npm run dev              # next dev — Next.js dev server on port 3000
npm run build            # next build
npm start                # next start — production server
npm run deploy:contract  # forge script deploy to Sepolia (requires forge in PATH)
```

```bash
# Foundry (run from contracts/)
forge build              # compile
forge test               # run tests
forge script script/Deploy.s.sol:DeployTraderAgent --rpc-url $ETH_SEPOLIA_RPC_URL --broadcast -vvv
```

Node.js ≥ 18 required. TypeScript 5.x. Foundry required for contract work — install via https://getfoundry.sh then run `forge install` inside `contracts/` to pull `forge-std`.

## Key design decisions

**No Redis.** All trade state lives in `TraderAgent.sol` on Ethereum Sepolia. `src/memory.ts` reads from the contract via ethers view calls. Price observations and LLM reasoning strings are kept in in-memory circular buffers inside `memory.ts` (they are ephemeral and high-frequency — storing them on-chain would cost significant gas).

**Contract is the DB.** `TraderAgent.sol` stores every trade as a `Trade` struct with full data: token, amount, entry/exit price in USD×1e8, P&L in cents, timestamps, status enum, confidence (0–100), and LLM reasoning string. The contract has `getRecentTrades(n)` and `getOpenTrade(token)` view functions the server reads from.

**Direction enum, not bool.** The contract uses `enum Direction { BUY, SELL, HOLD }`. BUY opens a position (`openTrade()` → emits `BuySignal`). SELL closes it (`emitSell()` → emits `SellSignal`). These are separate events so Kwala can use different Uniswap V3 function signatures.

**Pluggable LLM.** `src/llm.ts` is a factory. It reads `LLM_PROVIDER` env var (`custom` by default, `anthropic` opt-in) and delegates to `src/providers/custom.ts` or `src/providers/anthropic.ts`. The custom provider POSTs the context payload to `CUSTOM_LLM_URL`. By default `CUSTOM_LLM_URL=http://localhost:3000/api/llm`, which hits the built-in momentum strategy in `app/api/llm/route.ts`. Point it elsewhere to use an external model.

**Owner-only contract writes.** `PRIVATE_KEY` in `.env` is the deployer EOA. Only it can call `openTrade`, `emitSell`, `closeTrade`. This is NOT the Kwala smart wallet — that wallet only executes Uniswap swaps.

**Kwala does all swaps.** The server never signs swap transactions. It only calls the three owner functions above. Kwala listens for `BuySignal`/`SellSignal` events and executes the actual swaps via its smart wallet.

## File map

| File | Role |
|---|---|
| `app/page.tsx` | Dashboard. Client component; polls `/api/status` every 30s. Shows portfolio, open positions, price ticks, LLM reasoning, trades table. |
| `app/layout.tsx` | Root layout with dark background and metadata. |
| `app/api/observe/route.ts` | `POST /api/observe` — Kwala price oracle webhook. Saves observation, calls LLM, opens/closes trades. |
| `app/api/trade-fired/route.ts` | `POST /api/trade-fired` — Kwala swap-submitted confirmation. Logs acknowledgement. |
| `app/api/outcome/route.ts` | `POST /api/outcome` — Kwala settlement webhook. Fetches exit price from Chainlink, calls `closeTrade`. |
| `app/api/status/route.ts` | `GET /api/status` — returns portfolio, open trades, recent trades, prices, reasoning. |
| `app/api/llm/route.ts` | `POST /api/llm` — built-in momentum strategy (stop-loss −2%, take-profit +3%, momentum BUY on 3-tick uptrend). Edit this to change strategy. |
| `src/llm.ts` | Provider factory. Reads `LLM_PROVIDER`, delegates to provider module, catches errors and returns safe `HOLD`. |
| `src/providers/custom.ts` | Default LLM provider. POSTs context to `CUSTOM_LLM_URL` via axios, no auth. |
| `src/providers/anthropic.ts` | Anthropic provider. Uses `claude-opus-4-6`, 256 max tokens, JSON-only system prompt. |
| `src/memory.ts` | Contract read layer (`getRecentTrades`, `findOpenTrade`) + in-memory circular buffers for prices and reasoning. |
| `src/kwala.ts` | Contract write layer. `openTrade()`, `emitSell()`, `closeTrade()` — all use ethers v6, read from env. |
| `src/portfolio.ts` | Fetches ETH balance (via RPC) and USDC balance (via ERC-20 `balanceOf` on Sepolia USDC `0x1c7D...`). ETH price from Chainlink ETH/USD feed on Sepolia. |
| `src/types.ts` | Shared interfaces: `Trade`, `LLMDecision`, `MarketObservation`, `Portfolio`, Kwala payload types. |
| `contracts/src/TraderAgent.sol` | On-chain trade DB. Solidity 0.8.20. |
| `contracts/script/Deploy.s.sol` | Foundry deploy script. Reads `PRIVATE_KEY` from env, broadcasts to Sepolia. |
| `contracts/test/TraderAgent.t.sol` | Forge unit tests — ownership, full trade lifecycle, view functions. |
| `contracts/foundry.toml` | Foundry config: `solc=0.8.20`, rpc alias `sepolia`, etherscan verify config. |
| `kwala/*.yaml` | Kwala workflow configs. Not code — deployed via Kwala dashboard or MCP. |

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `custom` | `custom` or `anthropic` |
| `CUSTOM_LLM_URL` | — | Required when `LLM_PROVIDER=custom` |
| `ANTHROPIC_API_KEY` | — | Required when `LLM_PROVIDER=anthropic` |
| `ETH_SEPOLIA_RPC_URL` | — | Ethereum Sepolia RPC |
| `PRIVATE_KEY` | — | Deployer EOA (not Kwala smart wallet) |
| `TRADERAGENT_CONTRACT_ADDRESS` | — | Set after `npm run deploy:contract` |
| `KWALA_SMART_WALLET` | — | Kwala smart wallet address |
| `PORT` | `3000` | Next.js listen port (`next dev -p $PORT`) |

## Kwala workflow summary

| Workflow file | Trigger event | Action |
|---|---|---|
| `trader-observe-btc.yaml` | Cron every 1 hour — calls `latestAnswer()` on Chainlink BTC/USD feed | POST to `/api/observe` |
| `trader-execute-buy.yaml` | `BuySignal(uint256,address,uint256,uint256)` | `exactInputSingle` on Uniswap V3, POST to `/api/trade-fired` |
| `trader-execute-sell.yaml` | `SellSignal(uint256,address,uint256,uint256)` | `exactInputSingle` on Uniswap V3, POST to `/api/trade-fired` |
| `trader-outcome.yaml` | Token movement on Kwala smart wallet | POST to `/api/outcome` |

All workflows target chainId 11155111 (Ethereum Sepolia). Chainlink `latestAnswer()` returns a single `int256` referenced as `re.result(0)`. The `/api/observe` route divides the raw answer by 1e8 to get the USD price. `timestamp` is optional in the observe payload — the server uses `Date.now()` if omitted.

## Contract addresses (Ethereum Sepolia)

- Uniswap V3 SwapRouter02: `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48e`
- WETH: `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- USDC (Circle): `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- Chainlink ETH/USD feed: `0x694AA1769357215DE4FAC081bf1f309aDC325306`

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
