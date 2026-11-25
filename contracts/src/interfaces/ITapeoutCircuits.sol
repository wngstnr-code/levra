// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The reads of a TapeOut processor on X Layer (circuit NFTs), for the app and the backend. No Levra contract calls it:
/// circuits are soft layer only (D-55, D-66).
interface ITapeoutCircuits {
    /// Runs circuit `id` on packed input bits (LSB first) and returns the packed output bits.
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);

    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);

    function netlist(uint256 id) external view returns (bytes memory);

    function ownerOf(uint256 id) external view returns (address);
}
