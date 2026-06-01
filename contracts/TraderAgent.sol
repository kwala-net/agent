// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TraderAgent {
    enum Direction { BUY, SELL, HOLD }
    enum Status    { OPEN, PENDING_CLOSE, CLOSED, FAILED }

    struct Trade {
        uint256   id;
        address   token;
        uint256   amountWei;
        uint256   entryPrice;    // USD × 1e8
        uint256   exitPrice;     // USD × 1e8; 0 while open
        int256    pnlUsdCents;   // positive = profit
        uint256   openedAt;      // unix seconds
        uint256   closedAt;      // unix seconds; 0 while open
        Status    status;
        uint8     confidence;    // 0–100
        string    reasoning;
    }

    // Kwala workflow (buy) listens to this and calls swapExactETHForTokens
    event BuySignal(
        uint256 indexed tradeId,
        address indexed token,
        uint256 amountWei,
        uint256 entryPrice
    );

    // Kwala workflow (sell) listens to this and calls swapExactTokensForETH
    event SellSignal(
        uint256 indexed tradeId,
        address indexed token,
        uint256 amountWei,
        uint256 entryPrice
    );

    event TradeClosed(
        uint256 indexed tradeId,
        uint256 exitPrice,
        int256  pnlUsdCents
    );

    address public owner;

    Trade[] private _trades;

    // token → (tradeId + 1); 0 means no open trade for this token
    mapping(address => uint256) private _openSlot;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── write ────────────────────────────────────────────────────────────────

    /// Records a new long position and emits BuySignal for Kwala to pick up.
    function openTrade(
        address          token,
        uint256          amountWei,
        uint256          entryPrice,
        uint8            confidence,
        string calldata  reasoning
    ) external onlyOwner returns (uint256 tradeId) {
        require(_openSlot[token] == 0, "Position already open");

        tradeId = _trades.length;
        _trades.push(Trade({
            id:          tradeId,
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

        _openSlot[token] = tradeId + 1;
        emit BuySignal(tradeId, token, amountWei, entryPrice);
    }

    /// Marks the trade pending-close and emits SellSignal for Kwala to pick up.
    function emitSell(uint256 tradeId) external onlyOwner {
        require(tradeId < _trades.length, "Invalid trade id");
        Trade storage t = _trades[tradeId];
        require(t.status == Status.OPEN, "Trade not open");

        t.status = Status.PENDING_CLOSE;
        emit SellSignal(tradeId, t.token, t.amountWei, t.entryPrice);
    }

    /// Called by the server when the swap settlement is confirmed.
    function closeTrade(
        uint256 tradeId,
        uint256 exitPrice,
        int256  pnlUsdCents
    ) external onlyOwner {
        require(tradeId < _trades.length, "Invalid trade id");
        Trade storage t = _trades[tradeId];
        require(
            t.status == Status.OPEN || t.status == Status.PENDING_CLOSE,
            "Trade not closeable"
        );

        t.exitPrice   = exitPrice;
        t.pnlUsdCents = pnlUsdCents;
        t.closedAt    = block.timestamp;
        t.status      = Status.CLOSED;
        _openSlot[t.token] = 0;

        emit TradeClosed(tradeId, exitPrice, pnlUsdCents);
    }

    // ── read ─────────────────────────────────────────────────────────────────

    function tradesCount() external view returns (uint256) {
        return _trades.length;
    }

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        require(tradeId < _trades.length, "Invalid trade id");
        return _trades[tradeId];
    }

    /// Returns up to n most-recent trades (oldest→newest).
    function getRecentTrades(uint256 n) external view returns (Trade[] memory) {
        uint256 total = _trades.length;
        uint256 start = n >= total ? 0 : total - n;
        uint256 len   = total - start;
        Trade[] memory out = new Trade[](len);
        for (uint256 i = 0; i < len; i++) {
            out[i] = _trades[start + i];
        }
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
