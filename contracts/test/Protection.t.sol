// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Session} from "../src/interfaces/Types.sol";
import {BaseTest} from "./Base.t.sol";

contract ProtectionTest is BaseTest {
    uint256 internal collateral;

    function setUp() public override {
        super.setUp();
        collateral = _openLong(100e6, 257e6);
    }

    /// Sells `sellUsd` worth of collateral at `fillBps` from the oracle price and repays `repayUsd` of debt.
    function _reduce(uint256 sellUsd, uint256 repayUsd, int256 fillBps)
        internal
        view
        returns (IMarginRouter.CloseParams memory)
    {
        Position memory position = _position(longId);
        uint256 sell = _stockFor(sellUsd, 0);
        return IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: uint256(position.borrowShares) * repayUsd / 257e6,
            withdrawAssets: sell,
            swapAmountIn: sell,
            swap: _swapData(AQQQ, USDC, sell, _usdcFor(sell, fillBps)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function _enterPreClose() internal {
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + 1 hours));
    }

    function test_softLimitDropsInThePreCloseWindow() public {
        assertEq(risk.currentSoftLtv(longId), SOFT_OPEN);
        assertFalse(risk.isClosedRegime());
        _enterPreClose();
        assertEq(risk.currentSoftLtv(longId), SOFT_CLOSED);
        assertTrue(risk.isClosedRegime());
        vm.warp(vm.getBlockTimestamp() + 1 hours + risk.CLOSE_GRACE() + 1);
        assertFalse(risk.isClosedRegime());
    }

    function test_keeperReducesAProtectedPositionAboveTheSoftLimit() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        uint256 ltvBefore = risk.positionLtv(longId, user);
        assertGt(ltvBefore, SOFT_CLOSED);

        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        uint256 userBefore = USDC.balanceOf(user);
        vm.prank(keeper);
        router.deleverage(user, p);

        assertLt(risk.positionLtv(longId, user), SOFT_CLOSED);
        assertApproxEqAbs(USDC.balanceOf(keeper), 41e6 * 30 / 10_000, 0.01e6);
        assertGt(USDC.balanceOf(user), userBefore);
        _assertRouterEmpty();
    }

    /// SC-86 loosens only the user's full close. A keeper still needs a fresh price.
    function test_keeperCannotReduceOnAStaleOracle() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        _mockOracle(Session.Regular, 3 hours, 3 hours, int128(uint128(_priceE8())));

        vm.prank(keeper);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        router.deleverage(user, p);
    }

    function test_onlyAKeeperMayDeleverage() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        vm.expectRevert(IMarginRouter.Unauthorized.selector);
        router.deleverage(user, p);
    }

    function test_deleverageNeedsTheUsersConsent() public {
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.ProtectionNotEnabled.selector);
        router.deleverage(user, p);
    }

    function test_deleverageRevertsWhileThePositionIsWithinTheSoftLimit() public {
        vm.prank(user);
        router.setProtection(longId, true);
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.PositionHealthy.selector);
        router.deleverage(user, p);
    }

    function test_keeperCannotSellFarBelowTheOraclePrice() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(45e6, 40e6, -600);
        vm.prank(keeper);
        vm.expectPartialRevert(IRiskManager.PriceDeviationTooHigh.selector);
        router.deleverage(user, p);
    }

    /// Review of 20 November: a keeper may not sell the whole position or far below the soft limit.
    function test_keeperCannotCloseThePositionInFull() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        Position memory position = _position(longId);
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: type(uint256).max,
            withdrawAssets: type(uint256).max,
            swapAmountIn: type(uint256).max,
            swap: _swapData(AQQQ, USDC, position.collateral, _usdcFor(position.collateral, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.DeleverageTooDeep.selector);
        router.deleverage(user, p);
    }

    /// An issuer pause marks the snapshot stale but must not stop a protective reduction.
    function test_keeperStillReducesWhileTheSnapshotIsMarkedStale() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        (uint256 priceE8, uint256 bid, uint256 ask, Session session, uint64 feedAt, uint64 publishedAt,) =
            longOracle.snapshot();
        vm.mockCall(
            address(longOracle),
            abi.encodeWithSelector(ISessionOracle.snapshot.selector),
            abi.encode(priceE8, bid, ask, Session.Unknown, feedAt, publishedAt, true)
        );
        uint256 ltvBefore = risk.positionLtv(longId, user);
        vm.prank(keeper);
        router.deleverage(user, p);
        assertLt(risk.positionLtv(longId, user), ltvBefore);
    }

    /// Review 3 of 20 November: withdrawing far more collateral than the debt repaid is refused, even when
    /// the LTV ends inside the window.
    function test_keeperCannotTakeOutMoreCollateralThanItRepays() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        p.withdrawAssets += _stockFor(5e6, 0);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.DeleverageTooLarge.selector);
        router.deleverage(user, p);
    }

    /// With a soft limit at or under the floor, a keeper still may not repay all debt.
    function test_keeperCannotRepayAllDebtUnderATinySoftLimit() public {
        vm.prank(user);
        router.setProtection(longId, true);
        IRiskManager.MarketConfig memory c = risk.config(longId);
        c.softLtvOpen = 0.04e18;
        c.softLtvClosed = 0.04e18;
        risk.setMarketConfig(longId, c);
        Position memory position = _position(longId);
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: type(uint256).max,
            withdrawAssets: position.collateral,
            swapAmountIn: position.collateral,
            swap: _swapData(AQQQ, USDC, position.collateral, _usdcFor(position.collateral, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.DeleverageTooDeep.selector);
        router.deleverage(user, p);
    }

    /// 04: no auto-deleverage after the close (review 4).
    function test_keeperCannotReduceWhileTheMarketIsClosed() public {
        vm.prank(user);
        router.setProtection(longId, true);
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        _mockOracle(Session.Closed, 0, 0, int128(int256(_priceE8())));
        vm.prank(keeper);
        vm.expectRevert(IMarginRouter.MarketClosed.selector);
        router.deleverage(user, p);
    }

    function test_keeperCannotMakeThePositionWorse() public {
        vm.prank(user);
        router.setProtection(longId, true);
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(20e6, 0, 0);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.LtvNotReduced.selector);
        router.deleverage(user, p);
    }

    function test_userCanTurnProtectionOff() public {
        vm.startPrank(user);
        router.setProtection(longId, true);
        router.setProtection(longId, false);
        vm.stopPrank();
        _enterPreClose();
        IMarginRouter.CloseParams memory p = _reduce(41e6, 40e6, 0);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.ProtectionNotEnabled.selector);
        router.deleverage(user, p);
    }
}
