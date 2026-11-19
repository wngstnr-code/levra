// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {Liquidator} from "../src/Liquidator.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {SwapTargets} from "../src/SwapTargets.sol";
import {BaseTest, TestSwapper} from "./Base.t.sol";

contract SwapTargetsHarness is SwapTargets {
    constructor(address[] memory targets, address forbidden) SwapTargets(targets, forbidden) {}

    function isSwapTarget(address target) external view returns (bool) {
        return _isSwapTarget(target);
    }
}

/// D-79: one to three swap targets, fixed at deployment. No fork needed.
contract SwapTargetsTest is Test {
    address internal constant MORPHO = address(0xB0B0);
    address internal constant A = address(0xA1);
    address internal constant B = address(0xB2);
    address internal constant C = address(0xC3);

    function _list(address a, address b, address c, uint256 n) internal pure returns (address[] memory l) {
        l = new address[](n);
        if (n > 0) l[0] = a;
        if (n > 1) l[1] = b;
        if (n > 2) l[2] = c;
    }

    function test_acceptsOneToThreeTargetsAndKnowsOnlyThose() public {
        for (uint256 n = 1; n <= 3; ++n) {
            SwapTargetsHarness h = new SwapTargetsHarness(_list(A, B, C, n), MORPHO);
            address[] memory got = h.swapTargets();
            assertEq(got.length, n);
            assertEq(got[0], A);
            assertTrue(h.isSwapTarget(A));
            assertEq(h.isSwapTarget(B), n > 1);
            assertEq(h.isSwapTarget(C), n > 2);
            assertFalse(h.isSwapTarget(address(0)), "the zero address is never a target");
            assertFalse(h.isSwapTarget(MORPHO));
        }
    }

    function test_refusesBadLists() public {
        address[] memory four = new address[](4);
        (four[0], four[1], four[2], four[3]) = (A, B, C, address(0xD4));
        address[][] memory lists = new address[][](6);
        lists[0] = new address[](0);
        lists[1] = four;
        lists[2] = _list(address(0), B, C, 3);
        lists[3] = _list(A, MORPHO, C, 3);
        lists[4] = _list(A, B, A, 3);
        lists[5] = _list(A, A, C, 2);
        for (uint256 i; i < lists.length; ++i) {
            vm.expectRevert(SwapTargets.InvalidSwapTargets.selector);
            new SwapTargetsHarness(lists[i], MORPHO);
        }
    }

    function testFuzz_onlyListedAddressesAreTargets(address probe) public {
        SwapTargetsHarness h = new SwapTargetsHarness(_list(A, B, C, 3), MORPHO);
        assertEq(h.isSwapTarget(probe), probe == A || probe == B || probe == C);
    }
}

/// The router with two targets on a Monad fork: a swap through the second target works, any other
/// address is still refused.
contract RouterWithTwoTargetsTest is BaseTest {
    TestSwapper internal second;

    function setUp() public override {
        super.setUp();
        second = new TestSwapper();
        address[] memory targets = new address[](2);
        (targets[0], targets[1]) = (address(swapper), address(second));
        router = new MarginRouter(MORPHO, risk, targets, address(this), feeRecipient, 10);
        router.setFees(10, 30, feeRecipient);
        deal(address(AQQQ), address(second), 1_000e18);
        vm.startPrank(user);
        USDC.approve(address(router), type(uint256).max);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
    }

    function test_opensThroughTheSecondTarget() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap.target = address(second);
        vm.prank(user);
        (uint256 collateral,) = router.openLong(p);
        assertGt(collateral, 0);
        _assertRouterEmpty();
    }

    function test_liquidatorKnowsTheSameTargets() public {
        Liquidator liquidator = new Liquidator(MORPHO, router.swapTargets(), address(this), feeRecipient);
        assertTrue(liquidator.isSwapTarget(address(second)));
        assertTrue(liquidator.isSwapTarget(address(swapper)));
        assertFalse(liquidator.isSwapTarget(address(MORPHO)));
        assertEq(liquidator.swapTargets().length, 2);
    }

    function test_stillRefusesAnAddressOutsideTheList() public {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap.target = address(new TestSwapper());
        vm.prank(user);
        vm.expectPartialRevert(IMarginRouter.SwapTargetNotAllowed.selector);
        router.openLong(p);
    }
}
