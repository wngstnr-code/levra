// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {SwapTargetGuard} from "../script/SwapTargetGuard.sol";

contract GuardHarness {
    function check(address[] memory targets, address[] memory spenders, address[] memory tokens) external pure {
        SwapTargetGuard.check(targets, spenders, tokens);
    }
}

/// BE-94 finding 3: no deployment may use one of its own tokens as a swap target or spender.
contract SwapTargetGuardTest is Test {
    GuardHarness internal guard = new GuardHarness();
    Deploy internal script = new Deploy();
    address internal constant TOKEN = address(0x7001);
    address internal constant ROUTER = address(0xA6);

    function _one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function test_refusesATokenAsTarget() public {
        vm.expectRevert(bytes("swap target is a token"));
        guard.check(_one(TOKEN), _one(address(0)), _one(TOKEN));
    }

    function test_refusesATokenAsSpender() public {
        vm.expectRevert(bytes("swap spender is a token"));
        guard.check(_one(ROUTER), _one(TOKEN), _one(TOKEN));
    }

    function test_acceptsTargetsThatAreNotTokens() public view {
        guard.check(_one(ROUTER), _one(address(0)), _one(TOKEN));
    }

    function test_everyChainConfigPasses() public view {
        string[3] memory configs = ["config/monad.json", "config/base.json", "config/xlayer.json"];
        for (uint256 i; i < configs.length; ++i) {
            string memory json = vm.readFile(configs[i]);
            address[] memory targets = vm.parseJsonAddressArray(json, ".swapTargets");
            address[] memory spenders = vm.keyExistsJson(json, ".swapSpenders")
                ? vm.parseJsonAddressArray(json, ".swapSpenders")
                : new address[](targets.length);
            guard.check(targets, spenders, script.tokensOf(json));
        }
    }

    function test_deployRefusesAConfigWithATokenAsTarget() public {
        string memory json = vm.readFile("config/base.json");
        string memory usdc = vm.toString(vm.parseJsonAddress(json, ".usdc"));
        string memory target = vm.toString(vm.parseJsonAddressArray(json, ".swapTargets")[0]);
        string memory bad = vm.replace(json, target, usdc);
        vm.chainId(8453);
        vm.expectRevert(bytes("swap target is a token"));
        script.deploy(bad, address(this), address(0xFEE));
    }
}
