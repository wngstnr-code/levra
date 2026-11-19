// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Coinbase's oracle registry on Base, keyed by the stock token.
interface ICoinbaseOracleRegistry {
    /// multiplier is WAD scaled, the same value as the token's uiMultiplier.
    function getOracleParams(address token) external view returns (uint256 multiplier, bool paused);
}
