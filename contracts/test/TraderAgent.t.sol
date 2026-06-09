// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {TraderAgent, Direction, Status, Round, Trade} from "../src/TraderAgent.sol";

contract TraderAgentTest is Test {
    TraderAgent agent;
    address token  = address(0xBEEF);
    address token2 = address(0xCAFE);

    // Redeclare events for vm.expectEmit
    event RoundRecorded(uint256 indexed roundId, Direction indexed action, uint256 price);
    event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event TradeClosed(uint256 indexed tradeId, uint256 exitPrice, int256 pnlUsdCents);

    function setUp() public {
        agent = new TraderAgent();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    function _recordRound(Direction action, uint256 amount)
        internal returns (uint256 roundId)
    {
        roundId = agent.recordRound(
            "BTC", 6000000000000, 1 ether, 500e6, 2500e8, action, amount, 75, "test reasoning"
        );
    }

    function _openTrade(address tok, uint256 amount)
        internal returns (uint256 roundId, uint256 tradeId)
    {
        roundId = _recordRound(Direction.BUY, amount);
        tradeId = agent.openTrade(roundId, tok, amount, 6000000000000, 75, "test reasoning");
    }

    // ── recordRound ───────────────────────────────────────────────────────────

    function test_recordRound_storesFields() public {
        uint256 id = agent.recordRound(
            "BTC", 6000000000000, 1 ether, 500e6, 2500e8,
            Direction.HOLD, 0, 50, "No signal"
        );

        assertEq(id, 0);
        assertEq(agent.roundsCount(), 1);

        Round memory r = agent.getRound(0);
        assertEq(r.id, 0);
        assertEq(r.token, "BTC");
        assertEq(r.price, 6000000000000);
        assertEq(r.ethBalanceWei, 1 ether);
        assertEq(r.usdcBalance, 500e6);
        assertEq(r.totalValueUsd, 2500e8);
        assertEq(uint8(r.action), uint8(Direction.HOLD));
        assertEq(r.amountWei, 0);
        assertEq(r.confidence, 50);
        assertEq(r.reasoning, "No signal");
        assertFalse(r.tradeOpened);
        assertGt(r.timestamp, 0);
    }

    function test_recordRound_emitsRoundRecorded() public {
        vm.expectEmit(true, true, false, true);
        emit RoundRecorded(0, Direction.BUY, 6000000000000);
        agent.recordRound("BTC", 6000000000000, 1 ether, 500e6, 2500e8, Direction.BUY, 1 ether, 75, "test");
    }

    function test_recordRound_incrementsId() public {
        agent.recordRound("BTC", 6000000000000, 1 ether, 500e6, 2500e8, Direction.HOLD, 0, 50, "r1");
        uint256 id = agent.recordRound("BTC", 6100000000000, 1 ether, 500e6, 2550e8, Direction.BUY, 1 ether, 70, "r2");
        assertEq(id, 1);
        assertEq(agent.roundsCount(), 2);
    }

    // ── openTrade ─────────────────────────────────────────────────────────────

    function test_openTrade_storesFields() public {
        (uint256 roundId, uint256 tradeId) = _openTrade(token, 1 ether);

        assertEq(tradeId, 0);
        assertEq(agent.tradesCount(), 1);

        Trade memory t = agent.getTrade(0);
        assertEq(t.id, 0);
        assertEq(t.roundId, roundId);
        assertEq(t.token, token);
        assertEq(t.amountWei, 1 ether);
        assertEq(t.entryPrice, 6000000000000);
        assertEq(t.confidence, 75);
        assertEq(uint8(t.status), uint8(Status.OPEN));
        assertGt(t.openedAt, 0);
    }

    function test_openTrade_linksRound() public {
        (uint256 roundId, uint256 tradeId) = _openTrade(token, 1 ether);

        Round memory r = agent.getRound(roundId);
        assertTrue(r.tradeOpened);
        assertEq(r.tradeId, tradeId);
    }

    function test_openTrade_emitsBuySignal() public {
        uint256 roundId = _recordRound(Direction.BUY, 1 ether);
        vm.expectEmit(true, true, false, true);
        emit BuySignal(0, token, 1 ether, 6000000000000);
        agent.openTrade(roundId, token, 1 ether, 6000000000000, 75, "test");
    }

    function test_openTrade_revertsOnInvalidRound() public {
        vm.expectRevert("Invalid round");
        agent.openTrade(99, token, 1 ether, 6000000000000, 75, "test");
    }

    function test_openTrade_revertsIfPositionAlreadyOpen() public {
        _openTrade(token, 1 ether);
        uint256 roundId2 = _recordRound(Direction.BUY, 1 ether);
        vm.expectRevert("Position already open");
        agent.openTrade(roundId2, token, 1 ether, 6000000000000, 75, "second");
    }

    function test_openTrade_getOpenTrade() public {
        _openTrade(token, 1 ether);
        (bool exists, Trade memory t) = agent.getOpenTrade(token);
        assertTrue(exists);
        assertEq(t.token, token);
    }

    function test_openTrade_allowsDifferentTokens() public {
        _openTrade(token, 1 ether);
        _openTrade(token2, 0.5 ether);
        assertEq(agent.tradesCount(), 2);
    }

    // ── emitSell ──────────────────────────────────────────────────────────────

    function test_emitSell_setsPendingClose() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.emitSell(tradeId);

        Trade memory t = agent.getTrade(tradeId);
        assertEq(uint8(t.status), uint8(Status.PENDING_CLOSE));
    }

    function test_emitSell_emitsSellSignal() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        vm.expectEmit(true, true, false, true);
        emit SellSignal(tradeId, token, 1 ether, 6000000000000);
        agent.emitSell(tradeId);
    }

    function test_emitSell_revertsOnInvalidId() public {
        vm.expectRevert("Invalid trade id");
        agent.emitSell(99);
    }

    function test_emitSell_revertsIfAlreadyPendingClose() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.emitSell(tradeId);
        vm.expectRevert("Trade not open");
        agent.emitSell(tradeId);
    }

    // ── closeTrade ────────────────────────────────────────────────────────────

    function test_closeTrade_setsFields() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.emitSell(tradeId);
        agent.closeTrade(tradeId, 6100000000000, 100_00);

        Trade memory t = agent.getTrade(tradeId);
        assertEq(t.exitPrice, 6100000000000);
        assertEq(t.pnlUsdCents, 100_00);
        assertEq(uint8(t.status), uint8(Status.CLOSED));
        assertGt(t.closedAt, 0);
    }

    function test_closeTrade_emitsTradeClosed() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.emitSell(tradeId);
        vm.expectEmit(true, false, false, true);
        emit TradeClosed(tradeId, 6100000000000, 100_00);
        agent.closeTrade(tradeId, 6100000000000, 100_00);
    }

    function test_closeTrade_clearsOpenSlot() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.emitSell(tradeId);
        agent.closeTrade(tradeId, 6100000000000, 100_00);

        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }

    function test_closeTrade_canCloseFromOpenState() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.closeTrade(tradeId, 6100000000000, -50_00);

        Trade memory t = agent.getTrade(tradeId);
        assertEq(uint8(t.status), uint8(Status.CLOSED));
        assertEq(t.pnlUsdCents, -50_00);
    }

    function test_closeTrade_revertsIfAlreadyClosed() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.closeTrade(tradeId, 6100000000000, 100_00);
        vm.expectRevert("Trade not closeable");
        agent.closeTrade(tradeId, 6200000000000, 200_00);
    }

    // ── view functions ────────────────────────────────────────────────────────

    function test_getRecentRounds_returnsInOrder() public {
        agent.recordRound("BTC", 6000000000000, 1 ether, 500e6, 2500e8, Direction.HOLD, 0, 50, "first");
        agent.recordRound("BTC", 6100000000000, 1 ether, 500e6, 2550e8, Direction.BUY, 1 ether, 75, "second");

        Round[] memory rounds = agent.getRecentRounds(2);
        assertEq(rounds.length, 2);
        assertEq(rounds[0].reasoning, "first");
        assertEq(rounds[1].reasoning, "second");
    }

    function test_getRecentRounds_clampsToAvailable() public {
        agent.recordRound("BTC", 6000000000000, 1 ether, 500e6, 2500e8, Direction.HOLD, 0, 50, "only");
        Round[] memory rounds = agent.getRecentRounds(10);
        assertEq(rounds.length, 1);
    }

    function test_getRecentTrades_returnsInOrder() public {
        _openTrade(token, 1 ether);
        _openTrade(token2, 0.5 ether);

        Trade[] memory trades = agent.getRecentTrades(2);
        assertEq(trades.length, 2);
        assertEq(trades[0].token, token);
        assertEq(trades[1].token, token2);
    }

    function test_getRecentTrades_clampsToAvailable() public {
        _openTrade(token, 1 ether);
        Trade[] memory trades = agent.getRecentTrades(10);
        assertEq(trades.length, 1);
    }

    function test_getOpenTrade_returnsFalseWhenNone() public view {
        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }

    function test_getOpenTrade_returnsFalseAfterClose() public {
        (, uint256 tradeId) = _openTrade(token, 1 ether);
        agent.closeTrade(tradeId, 6100000000000, 100_00);
        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }
}
