// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {Side} from "./Types.sol";

interface IRiskManager {
    /// LTV values are WAD. maxOracleAge is in seconds. maxPositionUsd has 6 decimals.
    struct MarketConfig {
        bool enabled;
        Side side;
        address oracle;
        uint64 softLtvOpen;
        uint64 softLtvClosed;
        uint32 maxDeviationBps;
        uint32 maxOracleAge;
        uint128 maxPositionUsd;
    }

    event MarketConfigured(Id indexed marketId, MarketConfig config);
    event NextCloseSet(uint64 nextCloseAt);
    event OpeningPaused(bool paused);
    event OracleAgeBoundsSet(Id indexed marketId, uint32 minOracleAge, uint32 capOracleAge);
    event MaxOracleAgeSet(Id indexed marketId, uint32 maxOracleAge);

    error MarketNotEnabled(Id marketId);
    error OpeningIsPaused();
    error PriceDeviationTooHigh(uint256 deviationBps, uint256 maxBps);
    error OracleStale(uint64 publishedAt);
    error SoftLimitExceeded(uint256 ltv, uint256 softLtv);
    error PositionCapExceeded(uint256 valueUsd, uint256 capUsd);
    error OracleAgeOutOfBounds(uint32 maxOracleAge, uint32 minOracleAge, uint32 capOracleAge);
    error Unauthorized();

    function config(Id id) external view returns (MarketConfig memory);

    function marketIds() external view returns (Id[] memory);

    /// Debt over collateral value at the oracle price, WAD. Zero when there is no debt.
    function positionLtv(Id id, address user) external view returns (uint256);

    /// True when the market is closed, unknown, or inside the pre-close window.
    function isClosedRegime() external view returns (bool);

    function currentSoftLtv(Id id) external view returns (uint256);

    function nextCloseAt() external view returns (uint64);

    function preCloseWindow() external view returns (uint32);

    function openingPaused() external view returns (bool);

    function checkOpen(Id id, address user, uint256 execPriceE8) external view;

    function setMarketConfig(Id id, MarketConfig calldata c) external;

    /// Guardian only. May only tighten.
    function tightenMarket(Id id, uint64 softLtvOpen, uint64 softLtvClosed, uint128 maxPositionUsd) external;

    function setOpeningPaused(bool paused) external;

    function setNextCloseAt(uint64 ts) external;

    function oracleAgePoster() external view returns (address);

    /// Seconds. A cap of zero means no bounds are set and the poster cannot act.
    function oracleAgeBounds(Id id) external view returns (uint32 minOracleAge, uint32 capOracleAge);

    /// Owner only. The cap may not exceed the hard source quote age of the market's oracle.
    function setOracleAgeBounds(Id id, uint32 minOracleAge, uint32 capOracleAge) external;

    /// Oracle age poster only. Moves maxOracleAge inside the bounds the owner set.
    function setMaxOracleAge(Id id, uint32 maxOracleAge) external;
}
