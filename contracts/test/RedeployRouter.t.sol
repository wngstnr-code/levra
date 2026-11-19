// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RedeployRouter} from "../script/RedeployRouter.s.sol";

/// SC-87 on a fork of Monad mainnet, after the live deployment: a new router and lens over the live
/// risk manager and markets, and the deployment file that keeps the old router for the indexer.
contract RedeployRouterTest is Test {
    /// 20 November 2026, after the live deployment of 13 October and the seed withdrawal of 12 November.
    uint256 internal constant FORK_BLOCK = 123_636_233;
    address internal constant LIVE_ROUTER = 0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6;
    address internal constant LIVE_RISK = 0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F;
    address internal constant KYBER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;

    RedeployRouter internal script;
    string internal config;
    string internal deployment;
    RedeployRouter.Redeployed internal r;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), FORK_BLOCK);
        script = new RedeployRouter();
        config = vm.readFile("config/monad.json");
        deployment = vm.readFile("deployments/monad.json");
        r = script.redeploy(config, deployment, address(script), address(0xFEE));
    }

    function test_newRouterAndLensSitOnTheLiveRiskManager() public view {
        assertEq(address(r.router.RISK()), LIVE_RISK);
        address[] memory targets = r.router.swapTargets();
        assertEq(targets.length, 1);
        assertEq(targets[0], KYBER);
        assertEq(r.router.feeBps(), 10);
        assertEq(r.router.keeperFeeBps(), 30);
        assertEq(address(r.lens.ROUTER()), address(r.router));
        assertTrue(address(r.router) != LIVE_ROUTER);
    }

    function test_deploymentFileKeepsTheOldRouter() public {
        string memory updated = script.updatedDeployment(deployment, r);
        assertEq(vm.parseJsonAddress(updated, ".router"), address(r.router));
        assertEq(vm.parseJsonAddress(updated, ".lens"), address(r.lens));
        assertEq(vm.parseJsonAddress(updated, ".riskManager"), LIVE_RISK);
        address[] memory previous = vm.parseJsonAddressArray(updated, ".previousRouters");
        assertEq(previous.length, 1);
        assertEq(previous[0], LIVE_ROUTER);
        assertEq(
            vm.parseJsonBytes32(updated, ".markets[4].marketId"),
            vm.parseJsonBytes32(deployment, ".markets[4].marketId")
        );

        RedeployRouter.Redeployed memory again = script.redeploy(config, updated, address(script), address(0xFEE));
        string memory twice = script.updatedDeployment(updated, again);
        previous = vm.parseJsonAddressArray(twice, ".previousRouters");
        assertEq(previous.length, 2);
        assertEq(previous[0], LIVE_ROUTER);
        assertEq(previous[1], address(r.router));
        assertEq(vm.parseJsonAddress(twice, ".router"), address(again.router));
    }
}
