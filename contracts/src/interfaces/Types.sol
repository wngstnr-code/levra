// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";

enum Side {
    Long,
    Short
}

/// Same order as the Anchored stock oracle.
enum Session {
    Unknown,
    PreMarket,
    Regular,
    PostMarket,
    Overnight,
    Closed
}

struct Swap {
    address target;
    bytes data;
    uint256 minOut;
}
