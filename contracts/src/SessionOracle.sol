// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAnchoredStockOracle} from "./interfaces/IAnchoredStockOracle.sol";
import {ISessionOracle} from "./interfaces/ISessionOracle.sol";
import {Session, Side} from "./interfaces/Types.sol";

/// Morpho oracle for one stock market, fed by the Anchored stock oracle.
/// Long markets hold the stock as collateral and lend the quote token. Short markets are the reverse.
contract SessionOracle is ISessionOracle {
    IAnchoredStockOracle public immutable STOCK_ORACLE;
    bytes32 public immutable priceId;
    Side public immutable side;

    /// Seconds. Applies to the source quote time while the market is not closed.
    uint64 public immutable MAX_FEED_AGE;
    /// Seconds. Applies to the on-chain publish time while the market is closed.
    uint64 public immutable MAX_PUBLISH_AGE;

    /// Long: multiplier of the 8 decimal price. Short: numerator divided by it.
    uint256 private immutable SCALE;

    constructor(
        IAnchoredStockOracle stockOracle,
        bytes32 priceId_,
        Side side_,
        uint8 stockDecimals,
        uint8 quoteDecimals,
        uint64 maxFeedAge,
        uint64 maxPublishAge
    ) {
        STOCK_ORACLE = stockOracle;
        priceId = priceId_;
        side = side_;
        MAX_FEED_AGE = maxFeedAge;
        MAX_PUBLISH_AGE = maxPublishAge;
        SCALE = side_ == Side.Long
            ? 10 ** (28 + uint256(quoteDecimals) - uint256(stockDecimals))
            : 10 ** (44 + uint256(stockDecimals) - uint256(quoteDecimals));
    }

    function price() external view returns (uint256) {
        IAnchoredStockOracle.PricePayload memory p = STOCK_ORACLE.latestPrice(priceId);
        if (_stale(p)) revert OracleStale(p.publishedAt);
        uint256 cautious = _cautious(p);
        return side == Side.Long ? cautious * SCALE : SCALE / cautious;
    }

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
        )
    {
        IAnchoredStockOracle.PricePayload memory p = STOCK_ORACLE.latestPrice(priceId);
        if (p.price <= 0) revert InvalidOraclePrice();
        priceE8 = uint256(uint128(p.price));
        bidE8 = p.bestBid > 0 ? uint256(uint128(p.bestBid)) : 0;
        askE8 = p.bestAsk > 0 ? uint256(uint128(p.bestAsk)) : 0;
        session = p.session;
        feedUpdatedAt = p.feedUpdateTimestamp;
        publishedAt = p.publishedAt;
        stale = _stale(p);
    }

    function _stale(IAnchoredStockOracle.PricePayload memory p) private view returns (bool) {
        if (p.session == Session.Closed) return _age(p.publishedAt) > MAX_PUBLISH_AGE;
        return _age(p.feedUpdateTimestamp) > MAX_FEED_AGE;
    }

    function _age(uint64 timestamp) private view returns (uint256) {
        return block.timestamp > timestamp ? block.timestamp - timestamp : 0;
    }

    /// Lower of price and best bid for a long market, higher of price and best ask for a short market.
    function _cautious(IAnchoredStockOracle.PricePayload memory p) private view returns (uint256) {
        if (p.price <= 0) revert InvalidOraclePrice();
        int128 chosen = p.price;
        if (side == Side.Long) {
            if (p.bestBid > 0 && p.bestBid < chosen) chosen = p.bestBid;
        } else {
            if (p.bestAsk > chosen) chosen = p.bestAsk;
        }
        return uint256(uint128(chosen));
    }
}
