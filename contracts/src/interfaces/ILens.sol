// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {Session, Side} from "./Types.sol";

interface ILens {
    /// LTV and rate values are WAD. Prices have 8 decimals. maxPositionUsd has 6 decimals.
    struct MarketView {
        Id marketId;
        Side side;
        bytes32 priceId;
        address collateralToken;
        address loanToken;
        uint256 lltv;
        uint256 softLtvOpen;
        uint256 softLtvClosed;
        uint256 currentSoftLtv;
        uint256 totalSupplyAssets;
        uint256 totalBorrowAssets;
        uint256 borrowRatePerSecond;
        uint256 priceE8;
        Session session;
        uint64 publishedAt;
        bool stale;
        bool enabled;
        uint256 maxPositionUsd;
    }

    /// collateral and debt are in base units. debt includes accrued interest.
    struct PositionView {
        Id marketId;
        Side side;
        uint256 collateral;
        uint256 debt;
        uint256 ltv;
        uint256 softLtv;
        uint256 lltv;
        uint256 liqPriceE8;
        bool protection;
    }

    function getMarkets() external view returns (MarketView[] memory);

    function getPositions(address user) external view returns (PositionView[] memory);
}
