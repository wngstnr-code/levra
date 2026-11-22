// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The Coinbase B20 transfer policy registry on Base.
interface IB20PolicyRegistry {
    function isAuthorized(uint64 policyId, address account) external view returns (bool);
}
