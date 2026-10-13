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
        assertGt(views[0].liqPriceE8, _priceE8() * 2);
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
