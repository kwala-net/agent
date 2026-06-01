# Trader Agent

A 24/7 autonomous crypto trading agent on Polygon. Kwala handles all on-chain automation, a pluggable LLM provider makes trading decisions, and the `TraderAgent` smart contract acts as the on-chain database — no Redis, no off-chain state store.

## Architecture

```
[Kwala oracle trigger]
        │
        ▼
   POST /observe
        │  fetches portfolio from RPC
        │  reads trade history from contract
        │  calls LLM provider
        ▼
  LLM decision
  (BUY / SELL / HOLD)
        │
   BUY ─┼─ openTrade() on TraderAgent contract
        │        └─ emits BuySignal
        │               └─ [Kwala execute-buy] → swapExactETHForTokens
        │
  SELL ─┼─ emitSell() on TraderAgent contract
        │        └─ emits SellSignal
        │               └─ [Kwala execute-sell] → swapExactTokensForETH
        │
  HOLD ─┴─ (no action)
        │
        ▼
[Kwala address tracker]
        │
        ▼
   POST /outcome
        │  closeTrade() on TraderAgent contract
        │  writes exit price + P&L on-chain
        ▼
   Trade record finalized (fully on-chain)
```

### Four Kwala workflows

| File | Trigger | What it does |
|---|---|---|
| `kwala/trader-observe.yaml` | ETH/USD oracle update on Polygon | POSTs price data to `/observe` |
| `kwala/trader-execute-buy.yaml` | `BuySignal` event from TraderAgent contract | Calls `swapExactETHForTokens` on Uniswap V2 via Kwala smart wallet |
| `kwala/trader-execute-sell.yaml` | `SellSignal` event from TraderAgent contract | Calls `swapExactTokensForETH` on Uniswap V2 via Kwala smart wallet |
| `kwala/trader-outcome.yaml` | Any token movement on the Kwala smart wallet | POSTs settlement data to `/outcome` |

### What the server does and doesn't do

The agent server (Node.js/TypeScript) is the only process you run. It:
- **Does**: receive Kwala webhooks, query the LLM, call `openTrade`/`emitSell`/`closeTrade` on the contract
- **Does not**: hold funds, sign swap transactions, or maintain a separate database

All swap execution is handled by Kwala's smart wallet. All trade state lives in the `TraderAgent` contract on Polygon.

---

## Smart contract — `TraderAgent.sol`

The contract is the source of truth for all trade data.

```
enum Direction { BUY, SELL, HOLD }
enum Status    { OPEN, PENDING_CLOSE, CLOSED, FAILED }

struct Trade {
    uint256  id
    address  token
    uint256  amountWei
    uint256  entryPrice    // USD × 1e8
    uint256  exitPrice     // USD × 1e8; 0 while open
    int256   pnlUsdCents   // positive = profit
    uint256  openedAt
    uint256  closedAt
    Status   status
    uint8    confidence    // 0–100
    string   reasoning
}
```

**Write functions** (owner-only):
- `openTrade(token, amountWei, entryPrice, confidence, reasoning)` — records trade, emits `BuySignal`
- `emitSell(tradeId)` — marks `PENDING_CLOSE`, emits `SellSignal`
- `closeTrade(tradeId, exitPrice, pnlUsdCents)` — finalizes the record on-chain

**Read functions** (free):
- `getRecentTrades(n)` — last n trades
- `getOpenTrade(token)` — current open position for a token
- `tradesCount()` — total trades ever

---

## LLM providers

The decision layer is pluggable. Set `LLM_PROVIDER` in `.env` to switch:

| `LLM_PROVIDER` | Description |
|---|---|
| `custom` **(default)** | POSTs the context payload to `CUSTOM_LLM_URL`. No auth headers. |
| `anthropic` | Uses Anthropic SDK with `claude-opus-4-6`. Requires `ANTHROPIC_API_KEY`. |

### Custom provider contract

Your endpoint receives a `POST` with `Content-Type: application/json`:

```json
{
  "market": {
    "token": "ETH",
    "current_price_usd": 3500.00,
    "timestamp": 1718000000,
    "chain": "polygon"
  },
  "portfolio": {
    "eth_balance": 0.5,
    "usdc_balance": 100.00,
    "total_value_usd": 1850.00
  },
  "recent_trades": [ ],
  "last_n_prices": [3500, 3490, 3510, 3480, 3520, 3505],
  "llm_reasoning_history": ["Held — no clear momentum signal."]
}
```

It must respond with:

```json
{
  "action": "BUY",
  "token": "ETH",
  "amount_eth": 0.05,
  "confidence": 0.72,
  "reasoning": "Momentum positive, no open position, risking 3% of portfolio."
}
```

`action` must be `"BUY"`, `"SELL"`, or `"HOLD"`. On any parse error, the server defaults to `HOLD`.

To add a new provider, create `src/providers/<name>.ts` exporting `getTradeDecision(...)` with the same signature, then add it to the `PROVIDERS` map in `src/llm.ts`.

---

## Prerequisites

- [Kwala](https://kwala.xyz) account with a smart wallet on Polygon
- Polygon wallet funded with MATIC (for deploying `TraderAgent` and calling its write functions)
- Polygon RPC URL (Alchemy, Infura, or public endpoint)
- One of: a `CUSTOM_LLM_URL` endpoint, or an Anthropic API key
- Node.js ≥ 18

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `custom` (default) or `anthropic` |
| `CUSTOM_LLM_URL` | If `LLM_PROVIDER=custom` | URL of your decision endpoint |
| `ANTHROPIC_API_KEY` | If `LLM_PROVIDER=anthropic` | Anthropic API key |
| `POLYGON_RPC_URL` | Yes | Polygon mainnet RPC URL |
| `PRIVATE_KEY` | Yes | Deployer EOA private key (NOT the Kwala smart wallet) |
| `TRADERAGENT_CONTRACT_ADDRESS` | After step 3 | Deployed contract address |
| `KWALA_SMART_WALLET` | Yes | Your Kwala smart wallet address |
| `PORT` | No | Server port (default: `3000`) |

### 3. Compile and deploy the TraderAgent contract

Compile `contracts/TraderAgent.sol` using your preferred tool:

**Option A — solc**
```bash
npm install -g solc
solcjs --bin contracts/TraderAgent.sol --output-dir artifacts/
```

**Option B — Foundry**
```bash
forge build
```

**Option C — Remix IDE**
Paste `contracts/TraderAgent.sol` → Compile → copy the bytecode from Compilation Details.

Then paste the bytecode into `scripts/deploy.ts` where indicated, and run:

```bash
npm run deploy:contract
```

Copy the printed contract address into `TRADERAGENT_CONTRACT_ADDRESS` in your `.env`.

### 4. Deploy Kwala workflows

The four YAML files in `kwala/` are deployed via the Kwala dashboard or Kwala MCP. Fill in every placeholder before deploying:

#### `kwala/trader-observe.yaml`
- `REPLACE_WITH_LIVE_ETH_PRICE` — current ETH/USD price at deploy time (e.g. `3500`)
- `REPLACE_WITH_YOUR_SERVER_URL` — your public server URL

#### `kwala/trader-execute-buy.yaml` and `kwala/trader-execute-sell.yaml`
- `REPLACE_WITH_TRADERAGENT_CONTRACT_ADDRESS` — address from step 3
- `REPLACE_WITH_KWALA_SMART_WALLET` — your Kwala smart wallet address (appears twice per file)
- `REPLACE_WITH_YOUR_SERVER_URL` — your public server URL

#### `kwala/trader-outcome.yaml`
- `REPLACE_WITH_KWALA_SMART_WALLET` — your Kwala smart wallet address
- `REPLACE_WITH_YOUR_SERVER_URL` — your public server URL

### 5. Run the server

**Local development:**
```bash
npm run dev
```

Expose it publicly so Kwala can POST to it:
```bash
ngrok http 3000
```

Use the ngrok HTTPS URL as `REPLACE_WITH_YOUR_SERVER_URL` in the workflow files.

**Production (Railway):**
1. Push to a GitHub repo
2. Connect to [Railway](https://railway.app)
3. Set all env vars in Railway's environment settings
4. Use the Railway-provided URL in the Kwala workflow files

**Production (Fly.io):**
```bash
fly launch
fly secrets set POLYGON_RPC_URL=... PRIVATE_KEY=... # etc.
fly deploy
```

**Build for production:**
```bash
npm run build
npm start
```

---

## Monitoring

**Health / status endpoint:**
```bash
curl https://your-server/status
```

```json
{
  "status": "ok",
  "recentTrades": [...],
  "recentPrices": [3450, 3460, 3455, 3470, 3440, 3480],
  "openTrades": [...]
}
```

**On-chain trade history** — query `getRecentTrades(n)` on the deployed `TraderAgent` contract directly from any block explorer or RPC client. All trade data (entry/exit price, P&L, LLM reasoning, confidence) is permanently stored on Polygon.

**Kwala dashboard** — execution logs for all four workflows, including retry history and on-chain transaction hashes for every swap.

**Server logs** — structured log line per request (`[http] METHOD /path STATUS Xms`) and per decision (`[observe] ETH=$3500 → BUY confidence=0.72 | Momentum positive...`).

---

## Project structure

```
trader-agent/
├── contracts/
│   └── TraderAgent.sol          on-chain trade DB + event emitter
├── kwala/
│   ├── trader-observe.yaml      price oracle → /observe
│   ├── trader-execute-buy.yaml  BuySignal → Uniswap buy swap
│   ├── trader-execute-sell.yaml SellSignal → Uniswap sell swap
│   └── trader-outcome.yaml      wallet tracker → /outcome
├── scripts/
│   └── deploy.ts                deploy TraderAgent to Polygon
├── src/
│   ├── server.ts                Express routes (/observe, /trade-fired, /outcome, /status)
│   ├── llm.ts                   provider factory (reads LLM_PROVIDER env var)
│   ├── providers/
│   │   ├── custom.ts            HTTP POST provider (default, no auth)
│   │   └── anthropic.ts         Anthropic SDK provider
│   ├── memory.ts                contract reads + in-memory price/reasoning buffers
│   ├── portfolio.ts             ETH + USDC balance fetcher via RPC
│   ├── kwala.ts                 openTrade / emitSell / closeTrade contract calls
│   └── types.ts                 shared TypeScript interfaces
├── .env.example
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```
