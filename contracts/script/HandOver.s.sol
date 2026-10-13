// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {GovernancePlan} from "./GovernancePlan.sol";

/// Moves ownership of an existing deployment to a timelock controlled by the team multisig.
/// Needs MULTISIG in the environment. Run by the current owner.
contract HandOver is Script {
    function run() external {
        address multisig = vm.envAddress("MULTISIG");
        string memory path = string.concat("deployments/", vm.envOr("DEPLOY_ENV", string("fork")), ".json");
        string memory json = vm.readFile(path);
        require(!vm.contains(json, '"timelock"'), "already handed over");

        RiskManager risk = RiskManager(vm.parseJsonAddress(json, ".riskManager"));
        address[] memory ownables = new address[](3);
        ownables[0] = address(risk);
        ownables[1] = vm.parseJsonAddress(json, ".router");
        ownables[2] = vm.parseJsonAddress(json, ".liquidator");

        vm.startBroadcast();
        TimelockController timelock = GovernancePlan.handOver(multisig, risk, ownables);
        vm.stopBroadcast();

        string memory entry = string.concat(',"timelock":"', vm.toString(address(timelock)), '","markets":');
        vm.writeFile(path, vm.replace(json, ',"markets":', entry));
        console.log("Timelock:", address(timelock));
        console.log("Next: from the multisig, schedule acceptOwnership() on each contract through the timelock,");
        console.log("wait for the delay, then execute. Until then the deployer is still the owner.");
    }
}
