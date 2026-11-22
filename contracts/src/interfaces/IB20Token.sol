// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A Coinbase B20 stock token on Base. Feature 0 is transfer. Scopes are keccak256 of TRANSFER_SENDER_POLICY,
/// TRANSFER_RECEIVER_POLICY and TRANSFER_EXECUTOR_POLICY.
interface IB20Token {
    function policyId(bytes32 policyScope) external view returns (uint64);
    function isPaused(uint8 feature) external view returns (bool);
}
