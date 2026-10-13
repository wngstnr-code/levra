// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Id, IMorpho} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMetaMorpho} from "../src/interfaces/IMetaMorpho.sol";
import {VaultPlan} from "./VaultPlan.sol";

/// Creates the USDC vault over the long markets of an existing deployment and records its address.
contract DeployVault is Script {
    IMorpho internal constant MORPHO = IMorpho(0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee);

    /// Field order follows the alphabetical key order of the deployment file.
    struct MarketEntry {
        address collateralToken;
        address loanToken;
        bytes32 marketId;
        address oracle;
        string side;
        string symbol;
    }

    function run() external {
        string memory path = string.concat("deployments/", vm.envOr("DEPLOY_ENV", string("fork")), ".json");
        string memory json = vm.readFile(path);
        require(!vm.contains(json, '"usdcVault"'), "vault already recorded");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", msg.sender);

        uint256 total;
        while (vm.keyExistsJson(json, string.concat(".markets[", vm.toString(total), "]"))) ++total;
        Id[] memory ids = new Id[](total);
        uint256[] memory caps = new uint256[](total);
        uint256 count;
        for (uint256 i; i < total; ++i) {
            string memory at = string.concat(".markets[", vm.toString(i), "]");
            if (keccak256(bytes(vm.parseJsonString(json, string.concat(at, ".side")))) != keccak256("long")) continue;
            ids[count] = Id.wrap(vm.parseJsonBytes32(json, string.concat(at, ".marketId")));
            caps[count] = VaultPlan.capFor(keccak256(bytes(vm.parseJsonString(json, string.concat(at, ".symbol")))));
            require(caps[count] > 0, "no cap planned for this stock");
            ++count;
        }
        assembly ("memory-safe") {
            mstore(ids, count)
            mstore(caps, count)
        }

        vm.startBroadcast();
        IMetaMorpho vault = VaultPlan.create(MORPHO, ids, caps, feeRecipient, bytes32(block.number));
        vm.stopBroadcast();

        string memory entry = string.concat(',"usdcVault":"', vm.toString(address(vault)), '","markets":');
        vm.writeFile(path, vm.replace(json, ',"markets":', entry));
    }
}
