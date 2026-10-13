// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IIrm} from "morpho-blue/src/interfaces/IIrm.sol";
import {Id, IMorpho, Market, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MorphoBalancesLib} from "morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";
import {ILens} from "./interfaces/ILens.sol";
import {IMarginRouter} from "./interfaces/IMarginRouter.sol";
import {IRiskManager} from "./interfaces/IRiskManager.sol";
import {ISessionOracle} from "./interfaces/ISessionOracle.sol";
import {Session, Side} from "./interfaces/Types.sol";

/// Read-only views over every market and position the router knows about.
contract Lens is ILens {
    using MorphoBalancesLib for IMorpho;

    uint256 private constant WAD = 1e18;

    IMorpho public immutable MORPHO;
    IRiskManager public immutable RISK;
    IMarginRouter public immutable ROUTER;

    constructor(IMorpho morpho, IRiskManager risk, IMarginRouter router) {
        MORPHO = morpho;
        RISK = risk;
        ROUTER = router;
    }

    function getMarkets() external view returns (MarketView[] memory views) {
        Id[] memory ids = RISK.marketIds();
        views = new MarketView[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            views[i] = _marketView(ids[i]);
        }
    }

    function getPositions(address user) external view returns (PositionView[] memory views) {
        Id[] memory ids = RISK.marketIds();
        PositionView[] memory all = new PositionView[](ids.length);
        uint256 count;
        for (uint256 i; i < ids.length; ++i) {
            Position memory p = MORPHO.position(ids[i], user);
            if (p.collateral == 0 && p.borrowShares == 0) continue;
            all[count++] = _positionView(ids[i], user, p.collateral);
        }
        views = new PositionView[](count);
        for (uint256 i; i < count; ++i) {
            views[i] = all[i];
        }
    }

    function _marketView(Id id) private view returns (MarketView memory v) {
        MarketParams memory mp = MORPHO.idToMarketParams(id);
        IRiskManager.MarketConfig memory c = RISK.config(id);
        v.marketId = id;
        v.side = c.side;
        v.priceId = ISessionOracle(c.oracle).priceId();
        v.collateralToken = mp.collateralToken;
        v.loanToken = mp.loanToken;
        v.lltv = mp.lltv;
        v.softLtvOpen = c.softLtvOpen;
        v.softLtvClosed = c.softLtvClosed;
        v.currentSoftLtv = RISK.currentSoftLtv(id);
        v.enabled = c.enabled;
        v.maxPositionUsd = c.maxPositionUsd;

        (v.totalSupplyAssets,, v.totalBorrowAssets,) = MORPHO.expectedMarketBalances(mp);
        Market memory market = MORPHO.market(id);
        if (mp.irm != address(0)) v.borrowRatePerSecond = IIrm(mp.irm).borrowRateView(mp, market);

        try ISessionOracle(c.oracle).snapshot() returns (
            uint256 priceE8, uint256, uint256, Session session, uint64 feedUpdatedAt, uint64 publishedAt, bool stale
        ) {
            v.priceE8 = priceE8;
            v.session = session;
            v.feedUpdatedAt = feedUpdatedAt;
            v.publishedAt = publishedAt;
            v.stale = stale;
        } catch {
            v.stale = true;
        }
    }

    function _positionView(Id id, address user, uint256 collateral) private view returns (PositionView memory v) {
        MarketParams memory mp = MORPHO.idToMarketParams(id);
        IRiskManager.MarketConfig memory c = RISK.config(id);
        v.marketId = id;
        v.side = c.side;
        v.collateral = collateral;
        v.debt = MORPHO.expectedBorrowAssets(mp, user);
        v.lltv = mp.lltv;
        v.softLtv = RISK.currentSoftLtv(id);
        v.protection = ROUTER.protectionEnabled(user, id);
        try RISK.positionLtv(id, user) returns (uint256 ltv) {
            v.ltv = ltv;
        } catch {}
        v.liqPriceE8 = _liqPriceE8(mp, c.side, collateral, v.debt);
    }

    /// Stock price at which the position reaches the hard limit.
    function _liqPriceE8(MarketParams memory mp, Side side, uint256 collateral, uint256 debt)
        private
        view
        returns (uint256)
    {
        if (debt == 0 || collateral == 0) return 0;
        if (side == Side.Long) {
            uint256 stockUnit = 10 ** IERC20Metadata(mp.collateralToken).decimals();
            uint256 quoteUnit = 10 ** IERC20Metadata(mp.loanToken).decimals();
            return Math.mulDiv(Math.mulDiv(debt, 1e8 * stockUnit, quoteUnit), WAD, collateral * mp.lltv / WAD * WAD);
        }
        uint256 stockUnitShort = 10 ** IERC20Metadata(mp.loanToken).decimals();
        uint256 quoteUnitShort = 10 ** IERC20Metadata(mp.collateralToken).decimals();
        return Math.mulDiv(Math.mulDiv(collateral, 1e8 * stockUnitShort, quoteUnitShort), mp.lltv, debt * WAD);
    }
}
