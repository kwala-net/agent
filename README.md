# Trader Agent

A 24/7 autonomous crypto trading agent on Ethereum Sepolia. Kwala handles all on-chain automation, a pluggable LLM provider makes trading decisions, and the `TraderAgent` smart contract acts as the on-chain database — no Redis, no separate state store.

---

## How it works

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Every 1 hour (cron)                          │
│                                                                     │
│  Kwala ──calls──▶ Chainlink BTC/USD feed (Sepolia)                  │
│                   latestAnswer() → raw price (USD × 1e8)            │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ POST /api/observe
                            │ { token: "BTC", price: "6000000000000" }
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js server (single process)                  │
│                                                                     │
│  /api/observe                                                       │
│    1. Divide price by 1e8  →  $60,000 USD                          │
│    2. Fetch portfolio (ETH + USDC balances via RPC)                 │
│    3. Read recent trades from TraderAgent contract                  │
│    4. Call LLM provider for a decision                              │
│                                                                     │
│         ┌─────────────────────────────────────────┐                │
│         │           LLM decision layer             │                │
│         │                                          │                │
│         │  LLM_PROVIDER=custom  →  POST to         │                │
│         │    CUSTOM_LLM_URL (default: /api/llm)    │                │
│         │    or /api/gemini (Gemini proxy, no key   │                │
│         │    required in the request)               │                │
│         │                                          │                │
│         │  LLM_PROVIDER=anthropic  →  Claude SDK   │                │
│         │  LLM_PROVIDER=gemini     →  Gemini SDK   │                │
│         └──────────────────┬──────────────────────┘                │
│                            │ { action, token, amount_eth,           │
│                            │   confidence, reasoning }              │
│                            ▼                                        │
│    5. recordRound() on TraderAgent contract  ← every tick,         │
│       including HOLDs. Stores BTC price, portfolio snapshot,        │
│       LLM action + reasoning permanently on-chain.                  │
│                            │                                        │
│         ┌──────────────────┼──────────────────────┐                │
│         │ BUY              │ SELL          │ HOLD  │                │
│         ▼                  ▼               ▼       │                │
│    openTrade()        emitSell()       (no action) │                │
│    → BuySignal        → SellSignal                 │                │
└────────┬───────────────────┬────────────────────────────────────────┘
         │                   │
         ▼                   ▼
┌────────────────┐  ┌─────────────────┐
│ Kwala          │  │ Kwala           │
│ execute-buy    │  │ execute-sell    │
│                │  │                 │
│ Uniswap V3     │  │ Uniswap V3      │
│ exactInput     │  │ exactInput      │
│ USDC → WETH    │  │ WETH → USDC     │
│                │  │                 │
│ POST           │  │ POST            │
│ /api/trade-    │  │ /api/trade-     │
│ fired          │  │ fired           │
└────────────────┘  └─────────────────┘
         │                   │
         └─────────┬─────────┘
                   │ (token movement on Kwala smart wallet)
                   ▼
         Kwala address tracker
                   │ POST /api/outcome
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  /api/outcome                                                       │
│    Fetch exit price from Chainlink BTC/USD                          │
│    Calculate P&L                                                    │
│    closeTrade() on TraderAgent contract                             │
│    → exitPrice + pnlUsdCents written on-chain permanently           │
└─────────────────────────────────────────────────────────────────────┘

                    Dashboard (app/page.tsx)
                    polls /api/status every 30s
                    displays: portfolio, open positions,
                    BTC price history, decision rounds,
                    trade table with P&L
```

### Key design points

- **Chainlink price is fetched by Kwala, not the contract.** Kwala calls `latestAnswer()` on the BTC/USD feed and passes the raw value to `/api/observe`. The contract stores whatever it receives. This is sufficient for an MVP — for production, the contract should call Chainlink itself to verify the price on-chain.
- **No access control (MVP).** Write functions on `TraderAgent.sol` have no `onlyOwner` modifier. Add role-based access before deploying to mainnet.
- **Signals-only mode.** The contract and server work without the Kwala swap workflows. `BuySignal`/`SellSignal` events are emitted and all rounds/trades are recorded — effectively paper trading with a permanent on-chain audit trail. Enable the swap workflows when ready to go live.
- **Single server.** The Next.js app is the only process you run. It serves the dashboard, handles Kwala webhooks, and hosts the LLM proxy endpoints — all on one port.
- **Every tick is on-chain.** `recordRound()` is called on every price observation, including HOLDs. The full history of decisions, prices, and portfolio snapshots is permanently on-chain.

---

## Four Kwala workflows

| File | Trigger | What it does |
|---|---|---|
| `kwala/trader-observe-btc.yaml` | Cron every 1 hour | POSTs to `/api/observe`; server fetches BTC/USD price from Chainlink directly |
| `kwala/trader-execute-buy.yaml` | `BuySignal` event from TraderAgent | `exactInputSingle` USDC→WETH on Uniswap V3 via Kwala smart wallet |
| `kwala/trader-execute-sell.yaml` | `SellSignal` event from TraderAgent | `exactInputSingle` WETH→USDC on Uniswap V3 via Kwala smart wallet |
| `kwala/trader-outcome.yaml` | Token movement on Kwala smart wallet | POSTs settlement data to `/api/outcome` |

---

## Smart contract — `TraderAgent.sol`

Deployed on Ethereum Sepolia. The source of truth for all rounds and trades.

```
struct Round {
    id, timestamp
    token, price (USD×1e8)          ← market input
    ethBalanceWei, usdcBalance,
    totalValueUsd                   ← portfolio snapshot
    action, amountWei, confidence,
    reasoning                       ← LLM decision
    tradeId, tradeOpened            ← trade linkage
}

struct Trade {
    id, roundId
    token (address), amountWei
    entryPrice, exitPrice (USD×1e8)
    pnlUsdCents
    openedAt, closedAt
    status (OPEN → PENDING_CLOSE → CLOSED)
    confidence, reasoning
}
```

**Events** (Kwala listens for these — signatures must not change):
- `BuySignal(tradeId, token, amountWei, entryPrice)` — triggers execute-buy workflow
- `SellSignal(tradeId, token, amountWei, entryPrice)` — triggers execute-sell workflow
- `RoundRecorded(roundId, action, price)` — emitted on every tick

---

## LLM providers

All run server-side inside Next.js. API keys never leave the server.

| `LLM_PROVIDER` | How it works | Required env |
|---|---|---|
| `custom` (default) | POSTs trading context to `CUSTOM_LLM_URL`, no auth headers | `CUSTOM_LLM_URL` |
| `anthropic` | Calls Claude directly via Anthropic SDK | `ANTHROPIC_API_KEY` |
| `gemini` | Calls Gemini 2.0 Flash directly via Google GenAI SDK | `GEMINI_API_KEY` |

**Built-in endpoints** (usable as `CUSTOM_LLM_URL`, no auth headers needed):
- `/api/llm` — momentum strategy: stop-loss −2%, take-profit +3%, BUY on 3-tick uptrend
- `/api/gemini` — Gemini proxy: same payload format, `GEMINI_API_KEY` stays server-side

The context payload sent to every LLM endpoint:

```json
{
  "market": { "token": "BTC", "current_price_usd": 60000, "timestamp": 1718000000, "chain": "sepolia" },
  "portfolio": { "eth_balance": 0.5, "usdc_balance": 100.0, "total_value_usd": 1850.0 },
  "recent_trades": [],
  "last_n_prices": [60000, 59800, 59500, 60100, 59900, 60200],
  "llm_reasoning_history": ["Held — no clear momentum signal."]
}
```

Expected response:

```json
{
  "action": "BUY",
  "token": "ETH",
  "amount_eth": 0.05,
  "confidence": 0.72,
  "reasoning": "Upward momentum on BTC, no open position, risking 3% of portfolio."
}
```

---

## Setup

### 1. Install dependencies

```bash
npm install
# Foundry (for contract work)
cd contracts && forge install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `LLM_PROVIDER` | No | `custom` (default), `anthropic`, or `gemini` |
| `CUSTOM_LLM_URL` | If `custom` | e.g. `http://localhost:3000/api/llm` |
| `ANTHROPIC_API_KEY` | If `anthropic` | |
| `GEMINI_API_KEY` | If `gemini` or using `/api/gemini` | |
| `ETH_SEPOLIA_RPC_URL` | Yes | Ethereum Sepolia RPC (Alchemy, Infura, etc.) |
| `PRIVATE_KEY` | Yes | Deployer EOA — calls `recordRound`, `openTrade`, etc. Not the Kwala smart wallet. |
| `TRADERAGENT_CONTRACT_ADDRESS` | After deploy | Set after step 3 |
| `KWALA_SMART_WALLET` | Yes | Your Kwala smart wallet address |

### 3. Deploy the contract

```bash
npm run deploy:contract
```

This runs `forge script script/Deploy.s.sol:DeployTraderAgent --rpc-url ... --broadcast --verify`. Copy the printed address into `TRADERAGENT_CONTRACT_ADDRESS` in `.env`.

### 4. Run the server

```bash
npm run dev        # development
npm run build && npm start  # production
```

Expose it publicly so Kwala can POST to your webhooks:

```bash
ngrok http 3000
```

### 5. Test manually

Trigger a price observation without Kwala (useful for local dev and signals-only demos):

```bash
curl -X POST http://localhost:3000/api/observe \
  -H "Content-Type: application/json" \
  -d '{"signal":"cron_tick","token":"BTC"}'
```

No price needed — the server fetches BTC/USD directly from the Chainlink feed on Sepolia. `signal` and `token` are both optional; omitting them is fine too.

### 6. Deploy Kwala workflows

Replace all placeholders in `kwala/*.yaml` and deploy via the Kwala dashboard or Kwala MCP:

- `REPLACE_WITH_YOUR_SERVER_URL` — your public server URL (ngrok or production)
- `REPLACE_WITH_KWALA_SMART_WALLET` — your Kwala smart wallet address

---

## Project structure

```
trader-agent/
├── app/
│   ├── page.tsx                    live dashboard (polls /api/status every 30s)
│   ├── layout.tsx
│   └── api/
│       ├── observe/route.ts        POST — Kwala price webhook → LLM → contract
│       ├── trade-fired/route.ts    POST — Kwala swap confirmation
│       ├── outcome/route.ts        POST — Kwala settlement → closeTrade
│       ├── status/route.ts         GET  — portfolio + rounds + trades for dashboard
│       ├── llm/route.ts            POST — built-in momentum strategy
│       └── gemini/route.ts         POST — Gemini proxy (no auth headers needed)
├── src/
│   ├── llm.ts                      provider factory
│   ├── providers/
│   │   ├── custom.ts               HTTP POST to CUSTOM_LLM_URL
│   │   ├── anthropic.ts            Anthropic SDK (claude-opus-4-6)
│   │   └── gemini.ts               Google GenAI SDK (gemini-2.0-flash)
│   ├── memory.ts                   contract reads + in-memory price/reasoning buffers
│   ├── portfolio.ts                ETH + USDC balance fetcher via RPC
│   ├── kwala.ts                    recordRound / openTrade / emitSell / closeTrade
│   └── types.ts                    shared TypeScript interfaces
├── contracts/
│   ├── src/TraderAgent.sol         on-chain trade DB + event emitter
│   ├── script/Deploy.s.sol         Foundry deploy script
│   ├── test/TraderAgent.t.sol      25 forge unit tests
│   └── foundry.toml
├── kwala/
│   ├── trader-observe-btc.yaml     cron → Chainlink → /api/observe
│   ├── trader-execute-buy.yaml     BuySignal → Uniswap V3 buy
│   ├── trader-execute-sell.yaml    SellSignal → Uniswap V3 sell
│   └── trader-outcome.yaml         wallet tracker → /api/outcome
├── .env.example
└── CLAUDE.md                       full design docs for Claude Code
```

---

## Contract addresses (Ethereum Sepolia)

| Contract | Address |
|---|---|
| Uniswap V3 SwapRouter02 | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48e` |
| WETH | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC (Circle) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Chainlink BTC/USD feed | `0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43` |
| Chainlink ETH/USD feed | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
