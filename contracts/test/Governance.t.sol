// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {Liquidator} from "../src/Liquidator.sol";
import {GovernancePlan} from "../script/GovernancePlan.sol";
import {BaseTest} from "./Base.t.sol";

/// After the handover no single key can loosen anything, and the multisig must wait.
contract GovernanceTest is BaseTest {
    address internal multisig = makeAddr("multisig");
    TimelockController internal timelock;
    Liquidator internal liquidator;
    address[] internal ownables;

    function setUp() public override {
        super.setUp();
        liquidator = new Liquidator(MORPHO, address(swapper), address(this), feeRecipient);
        ownables = [address(risk), address(router), address(liquidator)];
        timelock = GovernancePlan.handOver(multisig, risk, ownables);
    }

    function _throughTimelock(address target, bytes memory data) internal {
        vm.prank(multisig);
        timelock.schedule(target, 0, data, bytes32(0), bytes32(0), GovernancePlan.DELAY);
        vm.warp(vm.getBlockTimestamp() + GovernancePlan.DELAY);
        vm.prank(multisig);
        timelock.execute(target, 0, data, bytes32(0), bytes32(0));
    }

    function _accept() internal {
        for (uint256 i; i < ownables.length; ++i) {
            _throughTimelock(ownables[i], abi.encodeCall(Ownable2Step.acceptOwnership, ()));
        }
    }

    function test_deployerStaysOwnerUntilTheMultisigAccepts() public {
        assertEq(risk.owner(), address(this));
        assertEq(risk.pendingOwner(), address(timelock));
        _accept();
        assertEq(risk.owner(), address(timelock));
        assertEq(router.owner(), address(timelock));
        assertEq(liquidator.owner(), address(timelock));
    }

    function test_afterTheHandoverTheDeployerCanChangeNothing() public {
        _accept();
        IRiskManager.MarketConfig memory c = risk.config(longId);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        risk.setMarketConfig(longId, c);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        router.setFees(50, 30, address(this));
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        router.setKeeper(address(this), true);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        liquidator.setKeeper(address(this), true);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setOpeningPaused(true);
    }

    function test_looseningNeedsTheMultisigAndTheWait() public {
        _accept();
        IRiskManager.MarketConfig memory c = risk.config(longId);
        c.maxPositionUsd = c.maxPositionUsd * 2;
        bytes memory data = abi.encodeCall(IRiskManager.setMarketConfig, (longId, c));

        // The multisig cannot act directly, and cannot skip the wait.
        vm.prank(multisig);
        vm.expectPartialRevert(Ownable.OwnableUnauthorizedAccount.selector);
        risk.setMarketConfig(longId, c);

        vm.startPrank(multisig);
        timelock.schedule(address(risk), 0, data, bytes32(0), bytes32(0), GovernancePlan.DELAY);
        vm.expectRevert();
        timelock.execute(address(risk), 0, data, bytes32(0), bytes32(0));
        vm.stopPrank();

        vm.warp(vm.getBlockTimestamp() + GovernancePlan.DELAY);
        vm.prank(multisig);
        timelock.execute(address(risk), 0, data, bytes32(0), bytes32(0));
        assertEq(risk.config(longId).maxPositionUsd, c.maxPositionUsd);
    }

    function test_onlyTheMultisigCanUseTheTimelock() public {
        bytes memory data = abi.encodeCall(Ownable2Step.acceptOwnership, ());
        vm.expectRevert();
        timelock.schedule(address(risk), 0, data, bytes32(0), bytes32(0), GovernancePlan.DELAY);
    }

    function test_multisigTightensAndPausesAtOnce() public {
        _accept();
        vm.startPrank(multisig);
        risk.tightenMarket(longId, 0.7e18, 0.65e18, 100e6);
        risk.setOpeningPaused(true);
        vm.stopPrank();
        assertEq(risk.currentSoftLtv(longId), 0.7e18);
        assertTrue(risk.openingPaused());

        // Resuming is a loosening, so it goes through the timelock.
        vm.prank(multisig);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setOpeningPaused(false);
        _throughTimelock(address(risk), abi.encodeCall(IRiskManager.setOpeningPaused, (false)));
        assertFalse(risk.openingPaused());
    }
}
