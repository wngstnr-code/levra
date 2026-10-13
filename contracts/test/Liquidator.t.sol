// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {ILiquidator} from "../src/interfaces/ILiquidator.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {Session, Swap} from "../src/interfaces/Types.sol";
import {Liquidator} from "../src/Liquidator.sol";
import {BaseTest} from "./Base.t.sol";

contract LiquidatorTest is BaseTest {
    int128 internal constant START = 740e8;

    Liquidator internal liquidator;
    address internal treasury = makeAddr("treasury");

    function setUp() public override {
        super.setUp();
        liquidator = new Liquidator(MORPHO, address(swapper), address(this), treasury);
        liquidator.setKeeper(keeper, true);
        _mockOracle(Session.Regular, 0, 0, START);
    }

    function _openShort(uint256 margin, uint256 stockValueUsd) internal {
        uint256 borrow = _stockFor(stockValueUsd, 0);
        IMarginRouter.OpenParams memory p = IMarginRouter.OpenParams({
            marketId: shortId,
            margin: margin,
            borrowAssets: borrow,
            swap: _swapData(AQQQ, USDC, borrow, _usdcFor(borrow, 0)),
            maxLtv: SOFT_OPEN,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(user);
        router.openShort(p);
    }

    function _assertLiquidatorEmpty() internal view {
        assertEq(USDC.balanceOf(address(liquidator)), 0);
        assertEq(AQQQ.balanceOf(address(liquidator)), 0);
    }

    function test_liquidatesALongAfterThePriceFalls() public {
        uint256 collateral = _openLong(100e6, 257e6);
        _mockOracle(Session.Regular, 0, 0, START * 90 / 100);
        assertGt(risk.positionLtv(longId, user), LLTV);

        uint256 seized = collateral * 3 / 10;
        Swap memory swap = _swapData(AQQQ, USDC, seized, _usdcFor(seized, 0));
        uint256 sharesBefore = _position(longId).borrowShares;
        vm.prank(keeper);
        (int256 delta, uint256 left) = liquidator.liquidate(longId, user, seized, seized, swap, 0, 0);

        Position memory position = _position(longId);
        assertEq(position.collateral, collateral - seized);
        assertLt(position.borrowShares, sharesBefore);
        assertEq(left, 0);
        assertGt(delta, 0);
        // The bonus at a 77% hard limit is about 7.4% of the repaid amount.
        assertApproxEqRel(uint256(delta), _usdcFor(seized, 0) * 69 / 1000, 0.05e18);
        assertEq(USDC.balanceOf(treasury), uint256(delta));
        _assertLiquidatorEmpty();
    }

    function test_liquidatesAShortAfterThePriceRises() public {
        _openShort(100e6, 200e6);
        _mockOracle(Session.Regular, 0, 0, START * 120 / 100);
        assertGt(risk.positionLtv(shortId, user), LLTV);

        uint256 seized = 60e6;
        uint256 spend = 57e6;
        Swap memory swap = _swapData(USDC, AQQQ, spend, _stockFor(spend, 0));
        uint256 sharesBefore = _position(shortId).borrowShares;
        vm.prank(keeper);
        (int256 delta, uint256 left) = liquidator.liquidate(shortId, user, seized, spend, swap, 0, 2e6);

        assertLt(_position(shortId).borrowShares, sharesBefore);
        assertEq(left, 3e6);
        assertGe(delta, 0);
        assertEq(USDC.balanceOf(treasury), 3e6);
        assertEq(AQQQ.balanceOf(treasury), uint256(delta));
        _assertLiquidatorEmpty();
    }

    function test_refusesALossUnlessToldToCoverIt() public {
        uint256 collateral = _openLong(100e6, 257e6);
        _mockOracle(Session.Regular, 0, 0, START * 90 / 100);
        uint256 seized = collateral * 3 / 10;
        Swap memory badFill = _swapData(AQQQ, USDC, seized, _usdcFor(seized, -1_000));
        deal(address(USDC), address(liquidator), 20e6);

        vm.prank(keeper);
        vm.expectPartialRevert(ILiquidator.InsufficientResult.selector);
        liquidator.liquidate(longId, user, seized, seized, badFill, 0, 0);

        vm.prank(keeper);
        (int256 delta,) = liquidator.liquidate(longId, user, seized, seized, badFill, -10e6, 0);
        assertLt(delta, 0);
        assertEq(USDC.balanceOf(address(liquidator)), uint256(int256(20e6) + delta));
        assertEq(USDC.balanceOf(treasury), 0);
    }

    function test_cannotLiquidateAHealthyPosition() public {
        uint256 collateral = _openLong(100e6, 100e6);
        uint256 seized = collateral / 10;
        Swap memory swap = _swapData(AQQQ, USDC, seized, _usdcFor(seized, 0));
        vm.prank(keeper);
        vm.expectRevert(bytes("position is healthy"));
        liquidator.liquidate(longId, user, seized, seized, swap, 0, 0);
    }

    function test_onlyKeepersAndOnlyTheAllowedSwapTarget() public {
        uint256 collateral = _openLong(100e6, 257e6);
        _mockOracle(Session.Regular, 0, 0, START * 90 / 100);
        uint256 seized = collateral / 10;
        Swap memory swap = _swapData(AQQQ, USDC, seized, _usdcFor(seized, 0));

        vm.expectRevert(ILiquidator.Unauthorized.selector);
        liquidator.liquidate(longId, user, seized, seized, swap, 0, 0);

        swap.target = address(MORPHO);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ILiquidator.SwapTargetNotAllowed.selector, address(MORPHO)));
        liquidator.liquidate(longId, user, seized, seized, swap, 0, 0);
    }

    function test_callbackCannotBeCalledDirectly() public {
        vm.expectRevert(ILiquidator.NotMorpho.selector);
        liquidator.onMorphoLiquidate(1, "");
        vm.prank(address(MORPHO));
        vm.expectRevert(ILiquidator.Unauthorized.selector);
        liquidator.onMorphoLiquidate(1, "");
    }

    function test_ownerControlsKeepersTreasuryAndFloat() public {
        deal(address(USDC), address(liquidator), 5e6);
        liquidator.withdraw(USDC, treasury, 5e6);
        assertEq(USDC.balanceOf(treasury), 5e6);

        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert();
        liquidator.setKeeper(address(1), true);
        vm.expectRevert();
        liquidator.setTreasury(address(1));
        vm.expectRevert();
        liquidator.withdraw(USDC, address(1), 1);
        vm.stopPrank();
    }
}
