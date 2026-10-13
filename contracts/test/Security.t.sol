// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Authorization, Signature} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {Swap} from "../src/interfaces/Types.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {BaseTest} from "./Base.t.sol";

/// A hostile swap target. In the middle of the swap it calls back into the router.
contract ReentrantSwapper {
    bytes public attack;

    function setAttack(bytes calldata attack_) external {
        attack = attack_;
    }

    function swap() external {
        (bool ok, bytes memory result) = msg.sender.call(attack);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}

contract SecurityTest is BaseTest {
    uint256 internal key = 0xB0B;
    address internal newcomer = vm.addr(key);
    uint256 internal deadline;

    function setUp() public override {
        super.setUp();
        deal(address(USDC), newcomer, 500e6);
        deadline = block.timestamp + 1 hours;
    }

    function _firstUseCalls() internal view returns (bytes[] memory calls) {
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(key, address(router), 100e6, 0, deadline);
        (uint8 av, bytes32 ar, bytes32 as_) = _signAuthorization(key, address(router), true, 0, deadline);
        calls = new bytes[](3);
        calls[0] = abi.encodeCall(IMarginRouter.permitToken, (address(USDC), 100e6, deadline, pv, pr, ps));
        calls[1] = abi.encodeCall(IMarginRouter.authorizeWithSig, (newcomer, true, 0, deadline, av, ar, as_));
        calls[2] = abi.encodeCall(IMarginRouter.openLong, (_openLongParams(100e6, 100e6, 0)));
    }

    // ----- reentrancy (T-03) -----

    function _hostileRouter() internal returns (MarginRouter hostileRouter, ReentrantSwapper hostile) {
        hostile = new ReentrantSwapper();
        hostileRouter = new MarginRouter(MORPHO, risk, address(hostile), address(this), feeRecipient, 10);
        vm.startPrank(user);
        USDC.approve(address(hostileRouter), type(uint256).max);
        MORPHO.setAuthorization(address(hostileRouter), true);
        vm.stopPrank();
    }

    function _openThroughHostile(MarginRouter hostileRouter, ReentrantSwapper hostile) internal {
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap = Swap(address(hostile), abi.encodeCall(ReentrantSwapper.swap, ()), 0);
        vm.prank(user);
        vm.expectRevert(ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector);
        hostileRouter.openLong(p);
    }

    function test_swapTargetCannotReenterAnEntryPoint() public {
        (MarginRouter hostileRouter, ReentrantSwapper hostile) = _hostileRouter();
        hostile.setAttack(abi.encodeCall(IMarginRouter.removeCollateral, (longId, 1)));
        _openThroughHostile(hostileRouter, hostile);
    }

    function test_swapTargetCannotReenterThroughMulticall() public {
        (MarginRouter hostileRouter, ReentrantSwapper hostile) = _hostileRouter();
        bytes[] memory inner = new bytes[](1);
        inner[0] = abi.encodeCall(IMarginRouter.addCollateral, (longId, 1));
        hostile.setAttack(abi.encodeCall(IMarginRouter.multicall, (inner)));
        _openThroughHostile(hostileRouter, hostile);
    }

    function test_swapTargetCannotFakeTheFlashCallback() public {
        (MarginRouter hostileRouter, ReentrantSwapper hostile) = _hostileRouter();
        hostile.setAttack(abi.encodeCall(MarginRouter.onMorphoFlashLoan, (1, "")));
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        p.swap = Swap(address(hostile), abi.encodeCall(ReentrantSwapper.swap, ()), 0);
        vm.prank(user);
        vm.expectRevert(IMarginRouter.NotMorpho.selector);
        hostileRouter.openLong(p);
    }

    // ----- signatures (T-10) -----

    function test_firstUseSignaturesCannotBeUsedTwice() public {
        bytes[] memory calls = _firstUseCalls();
        vm.prank(newcomer);
        router.multicall(calls);

        // The same batch again: the permit is spent, so the router cannot pull the margin.
        vm.prank(newcomer);
        vm.expectRevert();
        router.multicall(calls);
        assertEq(USDC.balanceOf(newcomer), 400e6);
    }

    function test_revokedAuthorizationCannotBeRestoredWithTheOldSignature() public {
        bytes[] memory calls = _firstUseCalls();
        vm.prank(newcomer);
        router.multicall(calls);
        vm.prank(newcomer);
        MORPHO.setAuthorization(address(router), false);

        (uint8 v, bytes32 r, bytes32 s) = _signAuthorization(key, address(router), true, 0, deadline);
        Authorization memory authorization = Authorization(newcomer, address(router), true, 0, deadline);
        vm.expectRevert();
        MORPHO.setAuthorizationWithSig(authorization, Signature(v, r, s));

        vm.prank(newcomer);
        vm.expectRevert(IMarginRouter.Unauthorized.selector);
        router.authorizeWithSig(newcomer, true, 0, deadline, v, r, s);
        assertFalse(MORPHO.isAuthorized(newcomer, address(router)));
    }

    function test_someoneSubmittingTheSignaturesFirstDoesNotBlockTheUser() public {
        bytes[] memory calls = _firstUseCalls();
        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(key, address(router), 100e6, 0, deadline);
        (uint8 av, bytes32 ar, bytes32 as_) = _signAuthorization(key, address(router), true, 0, deadline);

        vm.startPrank(makeAddr("frontrunner"));
        IERC20Permit(address(USDC)).permit(newcomer, address(router), 100e6, deadline, pv, pr, ps);
        MORPHO.setAuthorizationWithSig(
            Authorization(newcomer, address(router), true, 0, deadline), Signature(av, ar, as_)
        );
        vm.stopPrank();

        vm.prank(newcomer);
        router.multicall(calls);
        assertGt(MORPHO.position(longId, newcomer).collateral, 0);
        _assertRouterEmpty();
    }

    function test_aSignatureForAnotherSpenderGivesTheRouterNothing() public {
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(key, address(swapper), 100e6, 0, deadline);
        vm.prank(newcomer);
        router.permitToken(address(USDC), 100e6, deadline, v, r, s);
        assertEq(USDC.allowance(newcomer, address(router)), 0);
    }

    function test_expiredSignaturesAreRejected() public {
        bytes[] memory calls = _firstUseCalls();
        vm.warp(deadline + 1);
        vm.prank(newcomer);
        vm.expectRevert();
        router.multicall(calls);
    }
}
