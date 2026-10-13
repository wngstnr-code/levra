// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {Session} from "../src/interfaces/Types.sol";
import {BaseTest} from "./Base.t.sol";

/// One weekend from start to end: two positions, one protected and one not, and a gap at the open.
contract MarketHoursTest is BaseTest {
    int128 internal constant FRIDAY_PRICE = 740e8;
    /// The worst weekend drop for QQQ in five years was 5.4%.
    int128 internal constant MONDAY_PRICE = 740e8 * 946 / 1000;

    address internal alice = user;
    address internal bob = makeAddr("bob");
    address internal liquidator = makeAddr("liquidator");
    uint256 internal closeAt;

    function setUp() public override {
        super.setUp();
        deal(address(USDC), bob, 1_000e6);
        deal(address(USDC), liquidator, 1_000e6);
        vm.startPrank(bob);
        USDC.approve(address(router), type(uint256).max);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
        vm.prank(liquidator);
        USDC.approve(address(MORPHO), type(uint256).max);
    }

    function _open(address who, uint256 margin, uint256 borrow) internal {
        IMarginRouter.OpenParams memory p = _openLongParams(margin, borrow, 0);
        vm.prank(who);
        router.openLong(p);
    }

    function _reduceAlice(uint256 sellUsd, uint256 repayUsd, uint256 debtUsd)
        internal
        view
        returns (IMarginRouter.CloseParams memory)
    {
        Position memory position = MORPHO.position(longId, alice);
        uint256 sell = _stockFor(sellUsd, 0);
        return IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: uint256(position.borrowShares) * repayUsd / debtUsd,
            withdrawAssets: sell,
            swapAmountIn: sell,
            swap: _swapData(AQQQ, USDC, sell, _usdcFor(sell, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function test_aWeekendFromFridayToMonday() public {
        // Friday, a day before the close. The market is open and the soft limit is 73%.
        _mockOracle(Session.Regular, 15 minutes, 1 minutes, FRIDAY_PRICE);
        closeAt = vm.getBlockTimestamp() + 1 days;
        risk.setNextCloseAt(uint64(closeAt));
        assertEq(risk.currentSoftLtv(longId), SOFT_OPEN);

        // Alice opens at about 72% and turns protection on. Bob opens at about 73% and does not.
        _open(alice, 100e6, 257e6);
        _open(bob, 100e6, 268.75e6);
        vm.prank(alice);
        router.setProtection(longId, true);
        assertGt(risk.positionLtv(longId, bob), risk.positionLtv(longId, alice));

        // Four hours before the close the soft limit drops to 70%. Both are now above it.
        vm.warp(closeAt - 4 hours);
        _mockOracle(Session.PostMarket, 15 minutes, 1 minutes, FRIDAY_PRICE);
        assertEq(risk.currentSoftLtv(longId), SOFT_CLOSED);
        assertTrue(risk.isClosedRegime());
        assertGt(risk.positionLtv(longId, alice), SOFT_CLOSED);

        // A new position at 72% is refused in this window.
        address carol = makeAddr("carol");
        deal(address(USDC), carol, 1_000e6);
        vm.startPrank(carol);
        USDC.approve(address(router), type(uint256).max);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
        IMarginRouter.OpenParams memory late = _openLongParams(100e6, 257e6, 0);
        vm.prank(carol);
        vm.expectPartialRevert(IRiskManager.SoftLimitExceeded.selector);
        router.openLong(late);

        // Thirty minutes before the close the keeper reduces Alice. Bob gave no consent and is left alone.
        vm.warp(closeAt - 30 minutes);
        _mockOracle(Session.PostMarket, 15 minutes, 1 minutes, FRIDAY_PRICE);
        IMarginRouter.CloseParams memory reduce = _reduceAlice(41e6, 40e6, 257e6);
        vm.prank(keeper);
        router.deleverage(alice, reduce);
        assertLt(risk.positionLtv(longId, alice), SOFT_CLOSED);

        IMarginRouter.CloseParams memory reduceBob = _reduceAlice(41e6, 40e6, 257e6);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.ProtectionNotEnabled.selector);
        router.deleverage(bob, reduceBob);

        // Saturday. The oracle carries the Friday price, the quote time stands still, the heartbeat goes on.
        vm.warp(closeAt + 1 days);
        _mockOracle(Session.Closed, 1 days, 5 minutes, FRIDAY_PRICE);
        assertEq(risk.currentSoftLtv(longId), SOFT_CLOSED);
        assertGt(longOracle.price(), 0);

        // Closing is never blocked. Alice sells a little more over the weekend.
        IMarginRouter.CloseParams memory weekend = _reduceAlice(21e6, 20e6, 217e6);
        vm.prank(alice);
        router.closeLong(weekend);

        // Monday. The market opens 5.4% lower, the worst weekend drop of the last five years.
        vm.warp(closeAt + 2 days + 12 hours);
        _mockOracle(Session.PreMarket, 1 minutes, 1 minutes, MONDAY_PRICE);
        assertEq(risk.currentSoftLtv(longId), SOFT_OPEN);
        assertFalse(risk.isClosedRegime());

        // Alice is still healthy and cannot be liquidated.
        assertLt(risk.positionLtv(longId, alice), LLTV);
        vm.prank(liquidator);
        vm.expectRevert(bytes("position is healthy"));
        MORPHO.liquidate(longMarket, alice, 1e15, 0, "");

        // Bob is past the hard limit and gets liquidated.
        assertGt(risk.positionLtv(longId, bob), LLTV);
        uint256 collateralBefore = MORPHO.position(longId, bob).collateral;
        vm.prank(liquidator);
        MORPHO.liquidate(longMarket, bob, 1e16, 0, "");
        assertEq(MORPHO.position(longId, bob).collateral, collateralBefore - 1e16);
        _assertRouterEmpty();
    }
}
