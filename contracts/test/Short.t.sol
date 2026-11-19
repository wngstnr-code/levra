// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ILens} from "../src/interfaces/ILens.sol";
import {Side} from "../src/interfaces/Types.sol";
import {BaseTest} from "./Base.t.sol";

contract ShortTest is BaseTest {
    function _openShortParams(uint256 margin, uint256 stockValueUsd)
        internal
        view
        returns (IMarginRouter.OpenParams memory p, uint256 proceeds)
    {
        uint256 borrow = _stockFor(stockValueUsd, 0);
        proceeds = _usdcFor(borrow, 0);
        p = IMarginRouter.OpenParams({
            marketId: shortId,
            margin: margin,
            borrowAssets: borrow,
            swap: _swapData(AQQQ, USDC, borrow, proceeds),
            maxLtv: SOFT_OPEN,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function test_oracleIsTheInverseOfTheLongOracle() public view {
        (uint256 priceE8,, uint256 askE8,,,,) = shortOracle.snapshot();
        uint256 cautious = askE8 > priceE8 ? askE8 : priceE8;
        assertEq(shortOracle.price(), 1e56 / cautious);
        assertEq(uint8(shortOracle.side()), uint8(Side.Short));
    }

    function test_openShortKeepsProceedsAsCollateral() public {
        (IMarginRouter.OpenParams memory p, uint256 proceeds) = _openShortParams(100e6, 50e6);
        vm.prank(user);
        (uint256 debtAdded, uint256 ltv) = router.openShort(p);

        uint256 fee = proceeds * 10 / 10_000;
        Position memory position = _position(shortId);
        assertEq(debtAdded, p.borrowAssets);
        assertEq(position.collateral, 100e6 + proceeds - fee);
        assertApproxEqAbs(ltv, 0.3336e18, 0.003e18);
        assertEq(USDC.balanceOf(feeRecipient), fee);
        assertEq(USDC.balanceOf(user), 9_900e6);
        _assertRouterEmpty();

        ILens.PositionView[] memory views = lens.getPositions(user);
        assertEq(views.length, 1);
        assertEq(uint8(views[0].side), uint8(Side.Short));
        // Liquidation price = collateral * hard limit / debt, about 131% above the entry price.
        uint256 expected = uint256(position.collateral) * 1e20 * LLTV / (uint256(p.borrowAssets) * 1e18);
        assertApproxEqAbs(views[0].liqPriceE8, expected, 2);
        assertApproxEqRel(views[0].liqPriceE8, _priceE8() * 231 / 100, 0.01e18);
    }

    function test_openShortBeyondWhatMarginAloneCouldBorrow() public {
        (IMarginRouter.OpenParams memory p,) = _openShortParams(100e6, 200e6);
        vm.prank(user);
        (, uint256 ltv) = router.openShort(p);
        assertApproxEqAbs(ltv, 0.668e18, 0.004e18);
        _assertRouterEmpty();
    }

    function test_openShortRevertsAboveSoftLimit() public {
        (IMarginRouter.OpenParams memory p,) = _openShortParams(100e6, 300e6);
        p.maxLtv = 1e18;
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.SoftLimitExceeded.selector);
        router.openShort(p);
    }

    /// Opens a short at about 71% and enters the pre-close window (soft 70%, floor 65%), then builds a keeper
    /// reduction that buys back a tenth of the debt and withdraws `extraUsdc` on top of what it needs.
    function _protectedShortReduce(uint256 extraUsdc) internal returns (IMarginRouter.CloseParams memory) {
        (IMarginRouter.OpenParams memory open,) = _openShortParams(100e6, 245e6);
        vm.prank(user);
        router.openShort(open);
        vm.prank(user);
        router.setProtection(shortId, true);
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + 1 hours));

        Position memory position = _position(shortId);
        uint256 buyBack = open.borrowAssets / 10 + 1e12;
        uint256 spend = _usdcFor(buyBack, 0) + 1;
        return IMarginRouter.CloseParams({
            marketId: shortId,
            repayShares: uint256(position.borrowShares) / 10,
            withdrawAssets: spend * 10_050 / 10_000 + extraUsdc,
            swapAmountIn: spend,
            swap: _swapData(USDC, AQQQ, spend, buyBack),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function test_keeperReducesAProtectedShortInsideTheBounds() public {
        IMarginRouter.CloseParams memory p = _protectedShortReduce(0);
        uint256 before = risk.positionLtv(shortId, user);
        assertGt(before, risk.currentSoftLtv(shortId));
        vm.prank(keeper);
        router.deleverage(user, p);
        uint256 afterLtv = risk.positionLtv(shortId, user);
        assertLt(afterLtv, before);
        assertGe(afterLtv, risk.currentSoftLtv(shortId) - router.DELEVERAGE_FLOOR());
        _assertRouterEmpty();
    }

    function test_keeperCannotTakeOutMoreUsdcThanTheShortRepays() public {
        IMarginRouter.CloseParams memory p = _protectedShortReduce(3e6);
        vm.prank(keeper);
        vm.expectPartialRevert(IMarginRouter.DeleverageTooLarge.selector);
        router.deleverage(user, p);
    }

    function test_closeShortInFull() public {
        (IMarginRouter.OpenParams memory open,) = _openShortParams(100e6, 50e6);
        vm.prank(user);
        router.openShort(open);

        uint256 buyBack = open.borrowAssets + 1e12;
        uint256 spend = _usdcFor(buyBack, 0) + 1;
        IMarginRouter.CloseParams memory close = IMarginRouter.CloseParams({
            marketId: shortId,
            repayShares: type(uint256).max,
            withdrawAssets: type(uint256).max,
            swapAmountIn: spend,
            swap: _swapData(USDC, AQQQ, spend, buyBack),
            minReturn: 99e6,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(user);
        uint256 returned = router.closeShort(close);

        Position memory position = _position(shortId);
        assertEq(position.collateral, 0);
        assertEq(position.borrowShares, 0);
        assertApproxEqAbs(returned, 99.9e6, 0.05e6);
        assertEq(USDC.balanceOf(user), 9_900e6 + returned);
        assertGt(AQQQ.balanceOf(user), 0);
        _assertRouterEmpty();
    }

    function test_longFunctionsRejectAShortMarket() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.marketId = shortId;
        vm.prank(user);
        vm.expectPartialRevert(bytes4(keccak256("WrongSide(bytes32)")));
        router.openLong(p);
    }
}
