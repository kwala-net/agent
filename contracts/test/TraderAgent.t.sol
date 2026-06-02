// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {TraderAgent} from "../src/TraderAgent.sol";

contract TraderAgentTest is Test {
    TraderAgent agent;
    address notOwner;
    address token  = address(0xBEEF);
    address token2 = address(0xCAFE);

    event BuySignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event SellSignal(uint256 indexed tradeId, address indexed token, uint256 amountWei, uint256 entryPrice);
    event TradeClosed(uint256 indexed tradeId, uint256 exitPrice, int256 pnlUsdCents);

    function setUp() public {
        notOwner = makeAddr("notOwner");
        agent = new TraderAgent();
    }

    // ── ownership ─────────────────────────────────────────────────────────────

    function test_owner() public view {
        assertEq(agent.owner(), address(this));
    }

    function test_openTrade_revertsIfNotOwner() public {
        vm.prank(notOwner);
        vm.expectRevert("Not owner");
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
    }

    function test_emitSell_revertsIfNotOwner() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        vm.prank(notOwner);
        vm.expectRevert("Not owner");
        agent.emitSell(0);
    }

    function test_closeTrade_revertsIfNotOwner() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        vm.prank(notOwner);
        vm.expectRevert("Not owner");
        agent.closeTrade(0, 2100e8, 100_00);
    }

    // ── openTrade ─────────────────────────────────────────────────────────────

    function test_openTrade_storesFields() public {
        uint256 id = agent.openTrade(token, 1 ether, 2000e8, 75, "Upward momentum");

        assertEq(id, 0);
        assertEq(agent.tradesCount(), 1);

        TraderAgent.Trade memory t = agent.getTrade(0);
        assertEq(t.id, 0);
        assertEq(t.token, token);
        assertEq(t.amountWei, 1 ether);
        assertEq(t.entryPrice, 2000e8);
        assertEq(t.exitPrice, 0);
        assertEq(t.pnlUsdCents, 0);
        assertEq(t.confidence, 75);
        assertEq(t.reasoning, "Upward momentum");
        assertEq(uint8(t.status), uint8(TraderAgent.Status.OPEN));
        assertGt(t.openedAt, 0);
        assertEq(t.closedAt, 0);
    }

    function test_openTrade_emitsBuySignal() public {
        vm.expectEmit(true, true, false, true);
        emit BuySignal(0, token, 1 ether, 2000e8);
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
    }

    function test_openTrade_getOpenTrade() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");

        (bool exists, TraderAgent.Trade memory t) = agent.getOpenTrade(token);
        assertTrue(exists);
        assertEq(t.token, token);
    }

    function test_openTrade_revertsIfPositionAlreadyOpen() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "first");
        vm.expectRevert("Position already open");
        agent.openTrade(token, 1 ether, 2000e8, 75, "second");
    }

    function test_openTrade_allowsDifferentTokens() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "token1");
        agent.openTrade(token2, 0.5 ether, 3000e8, 60, "token2");
        assertEq(agent.tradesCount(), 2);
    }

    function test_openTrade_incrementsId() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "t1");
        agent.emitSell(0);
        agent.closeTrade(0, 2100e8, 100_00);

        uint256 id = agent.openTrade(token, 0.5 ether, 2100e8, 60, "t2");
        assertEq(id, 1);
    }

    // ── emitSell ──────────────────────────────────────────────────────────────

    function test_emitSell_setsPendingClose() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.emitSell(0);

        TraderAgent.Trade memory t = agent.getTrade(0);
        assertEq(uint8(t.status), uint8(TraderAgent.Status.PENDING_CLOSE));
    }

    function test_emitSell_emitsSellSignal() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        vm.expectEmit(true, true, false, true);
        emit SellSignal(0, token, 1 ether, 2000e8);
        agent.emitSell(0);
    }

    function test_emitSell_revertsOnInvalidId() public {
        vm.expectRevert("Invalid trade id");
        agent.emitSell(99);
    }

    function test_emitSell_revertsIfAlreadyPendingClose() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.emitSell(0);
        vm.expectRevert("Trade not open");
        agent.emitSell(0);
    }

    // ── closeTrade ────────────────────────────────────────────────────────────

    function test_closeTrade_setsFields() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.emitSell(0);
        agent.closeTrade(0, 2100e8, 100_00);

        TraderAgent.Trade memory t = agent.getTrade(0);
        assertEq(t.exitPrice, 2100e8);
        assertEq(t.pnlUsdCents, 100_00);
        assertEq(uint8(t.status), uint8(TraderAgent.Status.CLOSED));
        assertGt(t.closedAt, 0);
    }

    function test_closeTrade_emitsTradeClosed() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.emitSell(0);
        vm.expectEmit(true, false, false, true);
        emit TradeClosed(0, 2100e8, 100_00);
        agent.closeTrade(0, 2100e8, 100_00);
    }

    function test_closeTrade_clearsOpenSlot() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.emitSell(0);
        agent.closeTrade(0, 2100e8, 100_00);

        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }

    function test_closeTrade_canCloseFromOpenState() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.closeTrade(0, 2100e8, -50_00);

        TraderAgent.Trade memory t = agent.getTrade(0);
        assertEq(uint8(t.status), uint8(TraderAgent.Status.CLOSED));
        assertEq(t.pnlUsdCents, -50_00);
    }

    function test_closeTrade_revertsIfAlreadyClosed() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.closeTrade(0, 2100e8, 100_00);
        vm.expectRevert("Trade not closeable");
        agent.closeTrade(0, 2200e8, 200_00);
    }

    // ── view functions ────────────────────────────────────────────────────────

    function test_getRecentTrades_returnsInOrder() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "first");
        agent.openTrade(token2, 0.5 ether, 3000e8, 60, "second");

        TraderAgent.Trade[] memory trades = agent.getRecentTrades(2);
        assertEq(trades.length, 2);
        assertEq(trades[0].reasoning, "first");
        assertEq(trades[1].reasoning, "second");
    }

    function test_getRecentTrades_clampsToAvailable() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "only");
        TraderAgent.Trade[] memory trades = agent.getRecentTrades(10);
        assertEq(trades.length, 1);
    }

    function test_getRecentTrades_empty() public view {
        TraderAgent.Trade[] memory trades = agent.getRecentTrades(5);
        assertEq(trades.length, 0);
    }

    function test_getOpenTrade_returnsFalseWhenNone() public view {
        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }

    function test_getOpenTrade_returnsFalseAfterClose() public {
        agent.openTrade(token, 1 ether, 2000e8, 75, "test");
        agent.closeTrade(0, 2100e8, 100_00);

        (bool exists,) = agent.getOpenTrade(token);
        assertFalse(exists);
    }
}
