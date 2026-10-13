// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Id, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";

/// The parts of a MetaMorpho v1.1 vault that we use.
interface IMetaMorpho is IERC4626 {
    function owner() external view returns (address);

    function fee() external view returns (uint96);

    function feeRecipient() external view returns (address);

    function timelock() external view returns (uint256);

    function config(Id id) external view returns (uint184 cap, bool enabled, uint64 removableAt);

    function supplyQueueLength() external view returns (uint256);

    function submitCap(MarketParams memory marketParams, uint256 newSupplyCap) external;

    function acceptCap(MarketParams memory marketParams) external;

    function setSupplyQueue(Id[] calldata newSupplyQueue) external;

    function setFeeRecipient(address newFeeRecipient) external;

    function setFee(uint256 newFee) external;

    function submitTimelock(uint256 newTimelock) external;

    function transferOwnership(address newOwner) external;

    function pendingOwner() external view returns (address);

    function acceptOwnership() external;
}

interface IMetaMorphoFactory {
    function createMetaMorpho(
        address initialOwner,
        uint256 initialTimelock,
        address asset,
        string memory name,
        string memory symbol,
        bytes32 salt
    ) external returns (IMetaMorpho);
}
