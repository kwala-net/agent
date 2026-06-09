// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

enum Direction { BUY, SELL, HOLD }
enum Status    { OPEN, PENDING_CLOSE, CLOSED, FAILED }

// Full record of one observe→decide cycle written by the server.
struct Round {
    uint256   id;
    uint256   timestamp;
    // ── market input ──────────────────────────────────────────────────────
    string    token;          // price-feed ticker, e.g. "BTC"
    uint256   price;          // USD×1e8 (raw Chainlink latestAnswer)
    // ── portfolio snapshot at time of observation ─────────────────────────
    uint256   ethBalanceWei;  // Kwala wallet ETH balance in wei
    uint256   usdcBalance;    // USDC balance (6-decimal units)
    uint256   totalValueUsd;  // USD×1e8
    // ── LLM decision ─────────────────────────────────────────────────────
    Direction action;
    uint256   amountWei;      // intended trade size; 0 for HOLD/SELL
    uint8     confidence;     // 0–100
    string    reasoning;
    // ── trade linkage ─────────────────────────────────────────────────────
    uint256   tradeId;        // valid only when tradeOpened = true
    bool      tradeOpened;
}

struct Trade {
    uint256   id;
    uint256   roundId;        // Round that triggered this trade
    address   token;          // on-chain token address (WETH, WBTC, …)
    uint256   amountWei;
    uint256   entryPrice;     // USD×1e8
    uint256   exitPrice;      // USD×1e8; 0 while open
    int256    pnlUsdCents;    // positive = profit
    uint256   openedAt;       // unix seconds
    uint256   closedAt;       // unix seconds; 0 while open
    Status    status;
    uint8     confidence;     // 0–100
    string    reasoning;
}

// MVP: no access control — any caller can write. Add onlyOwner or a role-based
// guard before deploying to mainnet.
contract TraderAgent {
    // Kwala listens for these to execute swaps — signatures must not change.
    event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event TradeClosed(uint256 indexed tradeId, uint256 exitPrice, int256 pnlUsdCents);
    event RoundRecorded(uint256 indexed roundId, Direction indexed action, uint256 price);

    Round[] private _rounds;
    Trade[] private _trades;

    // token address → (tradeId + 1); 0 means no open trade for this token
    mapping(address => uint256) private _openSlot;

    // ── write ────────────────────────────────────────────────────────────────

    /// Records one full observe→decide cycle on-chain.
    /// Called by the server after fetching a price and getting an LLM decision,
    /// before any trade action is taken.
    function recordRound(
        string    calldata token,
        uint256   price,
        uint256   ethBalanceWei,
        uint256   usdcBalance,
        uint256   totalValueUsd,
        Direction action,
        uint256   amountWei,
        uint8     confidence,
        string    calldata reasoning
    ) external returns (uint256 roundId) {
        roundId = _rounds.length;
        _rounds.push(Round({
            id:            roundId,
            timestamp:     block.timestamp,
            token:         token,
            price:         price,
            ethBalanceWei: ethBalanceWei,
            usdcBalance:   usdcBalance,
            totalValueUsd: totalValueUsd,
            action:        action,
            amountWei:     amountWei,
            confidence:    confidence,
            reasoning:     reasoning,
            tradeId:       0,
            tradeOpened:   false
        }));
        emit RoundRecorded(roundId, action, price);
    }

    /// Opens a long position linked to a round; emits BuySignal for Kwala.
    function openTrade(
        uint256   roundId,
        address   token,
        uint256   amountWei,
        uint256   entryPrice,
        uint8     confidence,
        string    calldata reasoning
    ) external returns (uint256 tradeId) {
        require(roundId < _rounds.length, "Invalid round");
        require(_openSlot[token] == 0, "Position already open");

        tradeId = _trades.length;
        _trades.push(Trade({
            id:          tradeId,
            roundId:     roundId,
            token:       token,
            amountWei:   amountWei,
            entryPrice:  entryPrice,
            exitPrice:   0,
            pnlUsdCents: 0,
            openedAt:    block.timestamp,
            closedAt:    0,
            status:      Status.OPEN,
            confidence:  confidence,
            reasoning:   reasoning
        }));

        _openSlot[token]             = tradeId + 1;
        _rounds[roundId].tradeId     = tradeId;
        _rounds[roundId].tradeOpened = true;

        emit BuySignal(tradeId, token, amountWei, entryPrice);
    }

    /// Marks the trade pending-close; emits SellSignal for Kwala.
    function emitSell(uint256 tradeId) external {
        require(tradeId < _trades.length, "Invalid trade id");
        Trade storage t = _trades[tradeId];
        require(t.status == Status.OPEN, "Trade not open");

        t.status = Status.PENDING_CLOSE;
        emit SellSignal(tradeId, t.token, t.amountWei, t.entryPrice);
    }

    /// Called by the server when swap settlement is confirmed.
    function closeTrade(
        uint256 tradeId,
        uint256 exitPrice,
        int256  pnlUsdCents
    ) external {
        require(tradeId < _trades.length, "Invalid trade id");
        Trade storage t = _trades[tradeId];
        require(
            t.status == Status.OPEN || t.status == Status.PENDING_CLOSE,
            "Trade not closeable"
        );

        t.exitPrice    = exitPrice;
        t.pnlUsdCents  = pnlUsdCents;
        t.closedAt     = block.timestamp;
        t.status       = Status.CLOSED;
        _openSlot[t.token] = 0;

        emit TradeClosed(tradeId, exitPrice, pnlUsdCents);
    }

    // ── read ─────────────────────────────────────────────────────────────────

    function roundsCount() external view returns (uint256) { return _rounds.length; }
    function tradesCount() external view returns (uint256) { return _trades.length; }

    function getRound(uint256 roundId) external view returns (Round memory) {
        require(roundId < _rounds.length, "Invalid round id");
        return _rounds[roundId];
    }

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        require(tradeId < _trades.length, "Invalid trade id");
        return _trades[tradeId];
    }

    /// Returns up to n most-recent rounds (oldest → newest).
    function getRecentRounds(uint256 n) external view returns (Round[] memory) {
        uint256 total = _rounds.length;
        uint256 start = n >= total ? 0 : total - n;
        uint256 len   = total - start;
        Round[] memory out = new Round[](len);
        for (uint256 i = 0; i < len; i++) out[i] = _rounds[start + i];
        return out;
    }

    /// Returns up to n most-recent trades (oldest → newest).
    function getRecentTrades(uint256 n) external view returns (Trade[] memory) {
        uint256 total = _trades.length;
        uint256 start = n >= total ? 0 : total - n;
        uint256 len   = total - start;
        Trade[] memory out = new Trade[](len);
        for (uint256 i = 0; i < len; i++) out[i] = _trades[start + i];
        return out;
    }

    /// Returns the open (or pending-close) trade for a token, if any.
    function getOpenTrade(address token)
        external view
        returns (bool exists, Trade memory trade)
    {
        uint256 slot = _openSlot[token];
        if (slot == 0) return (false, trade);
        trade  = _trades[slot - 1];
        exists = trade.status == Status.OPEN || trade.status == Status.PENDING_CLOSE;
    }
}
