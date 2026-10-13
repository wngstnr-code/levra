// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RiskManager} from "../src/RiskManager.sol";

/// How control moves from the deployer key to the team multisig. Shared by the script and its test.
///
/// After this runs and the multisig has accepted:
/// - Loosening anything (limits, caps, fees, keepers) needs the multisig and then a wait of DELAY.
/// - Tightening and pausing is immediate, by the multisig as guardian.
/// - No single key can change anything.
library GovernancePlan {
    uint256 internal constant DELAY = 2 days;

    /// Deploys a timelock that only the multisig can propose to and execute from,
    /// hands it ownership of every contract given, and makes the multisig the guardian.
    /// Ownership is two-step, so the multisig must still schedule and run acceptOwnership on each contract.
    function handOver(address multisig, RiskManager risk, address[] memory ownables)
        internal
        returns (TimelockController timelock)
    {
        address[] memory operators = new address[](1);
        operators[0] = multisig;
        timelock = new TimelockController(DELAY, operators, operators, address(0));
        risk.setGuardian(multisig);
        for (uint256 i; i < ownables.length; ++i) {
            Ownable2Step(ownables[i]).transferOwnership(address(timelock));
        }
    }
}
