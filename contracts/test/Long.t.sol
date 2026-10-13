// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ILens} from "../src/interfaces/ILens.sol";
import {Swap} from "../src/interfaces/Types.sol";
import {BaseTest, TestSwapper} from "./Base.t.sol";

contract LongTest is BaseTest {
    function test_oracleValuesOneShareAtTheCautiousPrice() public view {
        (uint256 priceE8, uint256 bidE8,,,,,) = longOracle.snapshot();
        uint256 cautious = bidE8 > 0 && bidE8 < priceE8 ? bidE8 : priceE8;
        uint256 valueOfOneShare = 1e18 * longOracle.price() / 1e36;
        assertEq(valueOfOneShare, cautious / 100, "one share in USDC base units");
    }

    function test_openLongTwoTimes() public {
        uint256 collateral = _openLong(100e6, 100e6);

        Position memory p = _position(longId);
        assertEq(p.collateral, collateral);
        assertEq(collateral, _stockFor(199.8e6, 0));
        assertApproxEqAbs(risk.positionLtv(longId, user), 0.5005e18, 0.003e18);
        assertEq(USDC.balanceOf(feeRecipient), 0.2e6);
        assertEq(USDC.balanceOf(user), 9_900e6);
        _assertRouterEmpty();

        ILens.PositionView[] memory views = lens.getPositions(user);
        assertEq(views.length, 1);
        assertApproxEqAbs(views[0].debt, 100e6, 1);
        assertGt(views[0].liqPriceE8, 0);
        assertLt(views[0].liqPriceE8, _priceE8());
    }

    function test_closeLongInFull() public {
        uint256 collateral = _openLong(100e6, 100e6);
        uint256 proceeds = _usdcFor(collateral, 0);
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: type(uint256).max,
            withdrawAssets: type(uint256).max,
            swapAmountIn: type(uint256).max,
            swap: _swapData(AQQQ, USDC, collateral, proceeds),
            minReturn: 99e6,
            deadline: vm.getBlockTimestamp() + 60
        });

        vm.prank(user);
        uint256 returned = router.closeLong(p);

        Position memory position = _position(longId);
        assertEq(position.collateral, 0);
        assertEq(position.borrowShares, 0);
        assertApproxEqAbs(returned, 99.6e6, 0.05e6);
        assertEq(USDC.balanceOf(user), 9_900e6 + returned);
        _assertRouterEmpty();
    }

    function test_closeHalf() public {
        uint256 collateral = _openLong(100e6, 100e6);
        uint256 ltvBefore = risk.positionLtv(longId, user);
        Position memory before = _position(longId);
        uint256 half = collateral / 2;
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: before.borrowShares / 2,
            withdrawAssets: half,
            swapAmountIn: half,
            swap: _swapData(AQQQ, USDC, half, _usdcFor(half, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });

        vm.prank(user);
        router.closeLong(p);

        assertEq(_position(longId).collateral, collateral - half);
        assertApproxEqAbs(risk.positionLtv(longId, user), ltvBefore, 0.001e18);
        _assertRouterEmpty();
    }

    function test_revertsAboveSoftLimit() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 300e6, 0);
        p.maxLtv = 1e18;
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.SoftLimitExceeded.selector);
        router.openLong(p);
    }

    function test_revertsAboveUserLimit() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.maxLtv = 0.4e18;
        vm.prank(user);
        vm.expectPartialRevert(IMarginRouter.UserLimitExceeded.selector);
        router.openLong(p);
    }

    function test_revertsAbovePositionCap() public {
        IMarginRouter.OpenParams memory p = _openLongParams(3_000e6, 3_000e6, 0);
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.PositionCapExceeded.selector);
        router.openLong(p);
    }

    function test_revertsWhenFillIsFarFromOracle() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 50e6, -800);
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.PriceDeviationTooHigh.selector);
        router.openLong(p);
    }

    function test_revertsOnUnknownSwapTarget() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap.target = address(MORPHO);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IMarginRouter.SwapTargetNotAllowed.selector, address(MORPHO)));
        router.openLong(p);
    }

    function test_revertsWhenSwapReturnsLessThanMinimum() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap.minOut = p.swap.minOut + 1;
        vm.prank(user);
        vm.expectPartialRevert(IMarginRouter.InsufficientSwapOutput.selector);
        router.openLong(p);
    }

    function test_revertsAfterDeadline() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.deadline = vm.getBlockTimestamp() - 1;
        vm.prank(user);
        vm.expectRevert(IMarginRouter.DeadlineExpired.selector);
        router.openLong(p);
    }

    function test_openingCanBePausedButClosingCannot() public {
        uint256 collateral = _openLong(100e6, 100e6);
        risk.setOpeningPaused(true);

        IMarginRouter.OpenParams memory open = _openLongParams(100e6, 100e6, 0);
        vm.prank(user);
        vm.expectRevert(IRiskManager.OpeningIsPaused.selector);
        router.openLong(open);

        IMarginRouter.CloseParams memory close = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: type(uint256).max,
            withdrawAssets: type(uint256).max,
            swapAmountIn: type(uint256).max,
            swap: _swapData(AQQQ, USDC, collateral, _usdcFor(collateral, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(user);
        router.closeLong(close);
        assertEq(_position(longId).collateral, 0);
    }

    function test_flashCallbackCannotBeCalledDirectly() public {
        vm.expectRevert(IMarginRouter.NotMorpho.selector);
        router.onMorphoFlashLoan(1, "");
        vm.prank(address(MORPHO));
        vm.expectRevert(IMarginRouter.Unauthorized.selector);
        router.onMorphoFlashLoan(1, "");
    }

    function test_routerCannotActForSomeoneWhoDidNotAuthorize() public {
        address stranger = makeAddr("stranger");
        deal(address(USDC), stranger, 1_000e6);
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        vm.startPrank(stranger);
        USDC.approve(address(router), type(uint256).max);
        vm.expectRevert();
        router.openLong(p);
        vm.stopPrank();
    }

    function test_removeCollateralRespectsSoftLimit() public {
        uint256 collateral = _openLong(100e6, 100e6);
        vm.startPrank(user);
        router.removeCollateral(longId, collateral / 10);
        // Leaves the position between the soft limit and Morpho's hard limit.
        vm.expectPartialRevert(IRiskManager.SoftLimitExceeded.selector);
        router.removeCollateral(longId, collateral * 22 / 100);
        vm.stopPrank();
    }
}
