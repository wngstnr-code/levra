// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Session} from "./Types.sol";

interface IAnchoredStockOracle {
    /// Prices have 8 decimals.
    struct PricePayload {
        int128 price;
        int128 bestBid;
        int128 bestAsk;
        uint64 feedUpdateTimestamp;
        uint64 publishedAt;
        uint80 roundId;
        Session session;
    }

    /// priceId is keccak256 of the uppercase symbol, for example keccak256("QQQ").
    function latestPrice(bytes32 priceId) external view returns (PricePayload memory);
}
