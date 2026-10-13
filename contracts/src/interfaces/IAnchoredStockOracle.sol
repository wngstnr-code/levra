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

    /// Emitted on every price write. Topic 0x2e2fc593ffe55b85f00a028e4a1993370650ee81a0e86df35a306a346b85c07f, read from live logs.
    event PriceUpdated(
        bytes32 indexed priceId,
        int256 price,
        int256 bestBid,
        int256 bestAsk,
        uint64 feedUpdateTimestamp,
        uint64 publishedAt,
        uint80 roundId,
        Session session
    );

    /// priceId is keccak256 of the uppercase symbol, for example keccak256("QQQ").
    function latestPrice(bytes32 priceId) external view returns (PricePayload memory);
}
