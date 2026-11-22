// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Circle's USDC on every chain: a pause stops every transfer, a blacklisted account cannot send or receive.
interface ICircleToken {
    function paused() external view returns (bool);
    function isBlacklisted(address account) external view returns (bool);
}
