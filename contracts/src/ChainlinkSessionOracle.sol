// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChainlinkFeed} from "./interfaces/IChainlinkFeed.sol";
import {ICoinbaseOracleRegistry} from "./interfaces/ICoinbaseOracleRegistry.sol";
import {ISessionOracle} from "./interfaces/ISessionOracle.sol";
import {Session, Side} from "./interfaces/Types.sol";

/// Morpho oracle for one stock market, fed by a Chainlink style feed with 8 decimals, such as the
/// Coinbase stock feeds on Base. The feed carries no session, so the weekly close is fixed in UTC:
/// Saturday 00:00 to Monday 01:00 covers Friday 20:00 to Sunday 20:00 New York time in both summer
/// and winter. Holidays are not known on chain and count as open: a feed that has not written by then is
/// stale and the price stops (fail closed, D-92), while a close that repays all debt still works.
contract ChainlinkSessionOracle is ISessionOracle {
    error FeedDecimalsNot8(uint8 decimals);
    error InvalidPriceBounds();
    error RegistryWithoutToken();

    uint8 internal constant FEED_DECIMALS = 8;
    uint256 internal constant DAY = 1 days;
    /// Seconds into a UTC Monday at which the weekly close ends.
    uint256 internal constant MONDAY_OPEN = 1 hours;
    /// About ten times what getOracleParams uses on Base, so a failing registry cannot use up the gas of a liquidation.
    uint256 internal constant REGISTRY_GAS = 100_000;

    IChainlinkFeed public immutable FEED;
    /// Zero where the issuer has no registry, for example on X Layer.
    ICoinbaseOracleRegistry public immutable REGISTRY;
    /// The stock token, the key in the registry.
    address public immutable TOKEN;
    Side public immutable side;

    /// Seconds. Applies to the feed update time outside the weekly close.
    uint64 public immutable MAX_FEED_AGE;
    /// Seconds. Applies to the feed update time during the weekly close or an issuer pause.
    uint64 public immutable MAX_PUBLISH_AGE;

    /// 8 decimals. The feed's own bounds are too wide to catch a broken answer.
    uint256 public immutable MIN_PRICE_E8;
    uint256 public immutable MAX_PRICE_E8;

    /// Long: multiplier of the 8 decimal price. Short: numerator divided by it.
    uint256 private immutable SCALE;

    constructor(
        IChainlinkFeed feed,
        ICoinbaseOracleRegistry registry,
        address token,
        Side side_,
        uint8 stockDecimals,
        uint8 quoteDecimals,
        uint64 maxFeedAge,
        uint64 maxPublishAge,
        uint256 minPriceE8,
        uint256 maxPriceE8
    ) {
        uint8 feedDecimals = feed.decimals();
        if (feedDecimals != FEED_DECIMALS) revert FeedDecimalsNot8(feedDecimals);
        if (minPriceE8 == 0 || minPriceE8 >= maxPriceE8) revert InvalidPriceBounds();
        if (address(registry) != address(0) && token == address(0)) revert RegistryWithoutToken();
        FEED = feed;
        REGISTRY = registry;
        TOKEN = token;
        side = side_;
        MAX_FEED_AGE = maxFeedAge;
        MAX_PUBLISH_AGE = maxPublishAge;
        MIN_PRICE_E8 = minPriceE8;
        MAX_PRICE_E8 = maxPriceE8;
        SCALE = side_ == Side.Long
            ? 10 ** (28 + uint256(quoteDecimals) - uint256(stockDecimals))
            : 10 ** (44 + uint256(stockDecimals) - uint256(quoteDecimals));
    }

    /// The feed address, so one interface serves Anchored price IDs and Chainlink feeds.
    function priceId() external view returns (bytes32) {
        return bytes32(uint256(uint160(address(FEED))));
    }

    /// An issuer pause keeps the price usable on the closed clock, so closing, reducing and
    /// liquidating keep working while snapshot() refuses new positions. A registry that cannot be read
    /// never blocks the price and never loosens it: price() stays on the open clock, snapshot() refuses opens.
    function price() external view returns (uint256) {
        (uint256 p, uint64 updatedAt) = _read();
        (bool paused, bool readable) = _registry();
        bool closedClock = _weeklyClose(block.timestamp) || (readable && paused);
        if (_age(updatedAt) > _maxAge(closedClock)) revert OracleStale(updatedAt);
        return side == Side.Long ? p * SCALE : SCALE / p;
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
        uint64 updatedAt;
        (priceE8, updatedAt) = _read();
        (bool issuerPaused, bool readable) = _registry();
        bool paused = issuerPaused || !readable;
        bool closed = _weeklyClose(block.timestamp);
        session = paused ? Session.Unknown : closed ? Session.Closed : Session.Regular;
        feedUpdatedAt = updatedAt;
        publishedAt = updatedAt;
        stale = paused || _age(updatedAt) > _maxAge(closed);
    }

    /// True from Saturday 00:00 UTC to Monday 01:00 UTC. Day 0 of unix time was a Thursday.
    function isWeeklyClose(uint256 timestamp) external pure returns (bool) {
        return _weeklyClose(timestamp);
    }

    // slither-disable-start weak-prng
    // The modulo below finds the weekday and the time of day. Nothing here is random.
    function _weeklyClose(uint256 timestamp) private pure returns (bool) {
        uint256 weekday = (timestamp / DAY + 4) % 7;
        if (weekday == 6 || weekday == 0) return true;
        return weekday == 1 && timestamp % DAY < MONDAY_OPEN;
    }

    // slither-disable-end weak-prng

    function _read() private view returns (uint256 p, uint64 updatedAt) {
        (, int256 answer,, uint256 updated,) = FEED.latestRoundData();
        if (answer <= 0 || updated == 0 || updated > block.timestamp) revert InvalidOraclePrice();
        p = uint256(answer);
        if (p < MIN_PRICE_E8 || p > MAX_PRICE_E8) revert InvalidOraclePrice();
        updatedAt = uint64(updated);
    }

    /// Reads the issuer pause. Assembly, because try/catch does not catch return data that fails to decode,
    /// and copying the whole return data would let a hostile registry spend the caller's gas: only the
    /// second word (`paused`) is copied. No registry reads as readable and not paused.
    function _registry() private view returns (bool paused, bool readable) {
        address registry = address(REGISTRY);
        if (registry == address(0)) return (false, true);
        bytes memory data = abi.encodeCall(ICoinbaseOracleRegistry.getOracleParams, (TOKEN));
        bool ok;
        uint256 size;
        uint256 word;
        assembly ("memory-safe") {
            ok := staticcall(REGISTRY_GAS, registry, add(data, 0x20), mload(data), 0, 0)
            size := returndatasize()
            if and(ok, gt(size, 0x3f)) {
                returndatacopy(0, 0x20, 0x20)
                word := mload(0)
            }
        }
        if (!ok || size < 0x40) return (false, false);
        return (word != 0, true);
    }

    function _maxAge(bool closed) private view returns (uint64) {
        return closed ? MAX_PUBLISH_AGE : MAX_FEED_AGE;
    }

    function _age(uint64 timestamp) private view returns (uint256) {
        return block.timestamp > timestamp ? block.timestamp - timestamp : 0;
    }
}
