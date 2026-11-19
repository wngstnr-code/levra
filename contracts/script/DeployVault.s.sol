// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Id, IMorpho} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMetaMorpho, IMetaMorphoFactory} from "../src/interfaces/IMetaMorpho.sol";
import {VaultPlan} from "./VaultPlan.sol";

/// Creates the USDC vault over the long markets of an existing deployment and records its address.
/// Factory, USDC and supply caps come from the chain config (DEPLOY_CONFIG).
contract DeployVault is Script {
    function run() external {
        string memory config = vm.readFile(vm.envOr("DEPLOY_CONFIG", string("config/monad.json")));
        require(vm.parseJsonUint(config, ".chainId") == block.chainid, "config is for another chain");
        string memory path = string.concat("deployments/", vm.envOr("DEPLOY_ENV", string("fork")), ".json");
        string memory json = vm.readFile(path);
        require(!vm.contains(json, '"usdcVault"'), "vault already recorded");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", msg.sender);

        (Id[] memory ids, uint256[] memory caps) = longMarketsAndCaps(config, json);

        vm.startBroadcast();
        IMetaMorpho vault = VaultPlan.create(
            IMetaMorphoFactory(vm.parseJsonAddress(config, ".vaultFactory")),
            IMorpho(vm.parseJsonAddress(config, ".morpho")),
            vm.parseJsonAddress(config, ".usdc"),
            ids,
            caps,
            feeRecipient,
            bytes32(block.number)
        );
        vm.stopBroadcast();

        string memory entry = string.concat(',"usdcVault":"', vm.toString(address(vault)), '","markets":');
        vm.writeFile(path, vm.replace(json, ',"markets":', entry));
    }

    /// The long markets of the deployment file in order, each with the cap the config gives its stock.
    function longMarketsAndCaps(string memory config, string memory deployment)
        public
        view
        returns (Id[] memory ids, uint256[] memory caps)
    {
        uint256 total = _count(deployment, ".markets");
        ids = new Id[](total);
        caps = new uint256[](total);
        uint256 count;
        for (uint256 i; i < total; ++i) {
            string memory at = string.concat(".markets[", vm.toString(i), "]");
            if (keccak256(bytes(vm.parseJsonString(deployment, string.concat(at, ".side")))) != keccak256("long")) {
                continue;
            }
            ids[count] = Id.wrap(vm.parseJsonBytes32(deployment, string.concat(at, ".marketId")));
            caps[count] = _capFor(config, vm.parseJsonString(deployment, string.concat(at, ".symbol")));
            ++count;
        }
        assembly ("memory-safe") {
            mstore(ids, count)
            mstore(caps, count)
        }
    }

    function _capFor(string memory config, string memory symbol) internal view returns (uint256) {
        uint256 n = _count(config, ".vaultCaps");
        for (uint256 i; i < n; ++i) {
            string memory at = string.concat(".vaultCaps[", vm.toString(i), "]");
            if (keccak256(bytes(vm.parseJsonString(config, string.concat(at, ".symbol")))) == keccak256(bytes(symbol)))
            {
                return vm.parseJsonUint(config, string.concat(at, ".cap"));
            }
        }
        revert("no cap planned for this stock");
    }

    function _count(string memory json, string memory key) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(key, "[", vm.toString(n), "]"))) ++n;
    }
}
