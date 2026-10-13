// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOracle} from "morpho-blue/src/interfaces/IOracle.sol";
import {Session, Side} from "./Types.sol";

interface ISessionOracle is IOracle {
    error OracleStale(uint64 publishedAt);
    error InvalidOraclePrice();

    /// Prices have 8 decimals. feedUpdatedAt is the time of the source quote.
    function snapshot()
        external
        view
        returns (
            uint256 priceE8,
            uint256 bidE8,
            uint256 askE8,
            Session session,
            uint64 feedUpdatedAt,
            uint64 publishedAt,
            bool stale
        );

    function priceId() external view returns (bytes32);

    /// Seconds. Hard limit on the source quote age while the market is not closed.
    function MAX_FEED_AGE() external view returns (uint64);

    /// Seconds. Hard limit on the publish age while the market is closed.
    function MAX_PUBLISH_AGE() external view returns (uint64);

    function side() external view returns (Side);
}
