// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// The sanctions list the xStocks check on X Layer.
interface ISanctionsList {
    function isSanctioned(address account) external view returns (bool);
}
