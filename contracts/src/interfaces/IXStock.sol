// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// A wrapped xStock on X Layer, and the xStock under it.
interface IXStock {
    function isPaused() external view returns (bool);
    function asset() external view returns (address);
}
