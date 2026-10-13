// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMetaMorpho} from "../src/interfaces/IMetaMorpho.sol";
import {VaultPlan} from "../script/VaultPlan.sol";
import {BaseTest} from "./Base.t.sol";

/// The USDC vault, created from Morpho's own factory on a fork.
contract VaultTest is BaseTest {
    IMetaMorpho internal vault;
    address internal saver = makeAddr("saver");

    function setUp() public override {
        super.setUp();
        Id[] memory ids = new Id[](1);
        ids[0] = longId;
        uint256[] memory caps = new uint256[](1);
        caps[0] = VaultPlan.capFor(QQQ);
        vault = this.createVault(ids, caps);

        deal(address(USDC), saver, 50_000e6);
        vm.prank(saver);
        USDC.approve(address(vault), type(uint256).max);
    }

    function createVault(Id[] memory ids, uint256[] memory caps) external returns (IMetaMorpho) {
        return VaultPlan.create(MORPHO, ids, caps, feeRecipient, bytes32(uint256(1)));
    }

    function test_vaultIsConfiguredAsPlanned() public view {
        (uint184 cap, bool enabled,) = vault.config(longId);
        assertEq(vault.asset(), address(USDC));
        assertEq(vault.owner(), address(this));
        assertEq(cap, 10_000e6);
        assertTrue(enabled);
        assertEq(vault.supplyQueueLength(), 1);
        assertEq(vault.fee(), 0.1e18);
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.timelock(), 1 days);
    }

    function test_depositsFlowIntoTheStockMarket() public {
        uint256 supplyBefore = MORPHO.market(longId).totalSupplyAssets;
        vm.prank(saver);
        vault.deposit(1_000e6, saver);

        assertEq(MORPHO.market(longId).totalSupplyAssets, supplyBefore + 1_000e6);
        assertApproxEqAbs(vault.totalAssets(), 1_000e6, 1);
        assertEq(USDC.balanceOf(address(vault)), 0);
    }

    function test_saverCanWithdraw() public {
        vm.startPrank(saver);
        vault.deposit(1_000e6, saver);
        vault.redeem(vault.balanceOf(saver), saver, saver);
        vm.stopPrank();
        assertApproxEqAbs(USDC.balanceOf(saver), 50_000e6, 2);
    }

    function test_capLimitsWhatOneMarketCanReceive() public {
        vm.startPrank(saver);
        vault.deposit(10_000e6, saver);
        vm.expectRevert();
        vault.deposit(1e6, saver);
        vm.stopPrank();
    }

    function test_looseningTheVaultNowWaitsForTheTimelock() public {
        vault.submitCap(longMarket, 50_000e6);
        vm.expectRevert();
        vault.acceptCap(longMarket);
        (uint184 cap,,) = vault.config(longId);
        assertEq(cap, 10_000e6);
    }

    function test_borrowersUseVaultLiquidity() public {
        vm.prank(lender);
        MORPHO.withdraw(longMarket, 100_000e6, 0, lender, lender);
        vm.prank(saver);
        vault.deposit(5_000e6, saver);

        _openLong(100e6, 100e6);
        assertEq(MORPHO.market(longId).totalBorrowAssets, 100e6);
        assertEq(MORPHO.market(longId).totalSupplyAssets, 5_000e6);
    }
}
