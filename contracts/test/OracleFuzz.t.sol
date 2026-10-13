// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAnchoredStockOracle} from "../src/interfaces/IAnchoredStockOracle.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Session, Side} from "../src/interfaces/Types.sol";
import {SessionOracle} from "../src/SessionOracle.sol";

/// Stands in for the Anchored oracle so any payload can be tried. No fork needed.
contract FakeStockOracle {
    IAnchoredStockOracle.PricePayload internal payload;

    function set(IAnchoredStockOracle.PricePayload memory p) external {
        payload = p;
    }

    function latestPrice(bytes32) external view returns (IAnchoredStockOracle.PricePayload memory) {
        return payload;
    }
}

/// Properties of SessionOracle that must hold for every price, spread, session and age.
contract OracleFuzzTest is Test {
    uint64 internal constant MAX_FEED_AGE = 1 hours;
    uint64 internal constant MAX_PUBLISH_AGE = 4 days;
    /// Up to one million dollars a share.
    int128 internal constant MAX_PRICE = 1e14;

    FakeStockOracle internal source;
    SessionOracle internal long;
    SessionOracle internal short;

    function setUp() public {
        vm.warp(1_800_000_000);
        source = new FakeStockOracle();
        IAnchoredStockOracle stock = IAnchoredStockOracle(address(source));
        long = new SessionOracle(stock, keccak256("QQQ"), Side.Long, 18, 6, MAX_FEED_AGE, MAX_PUBLISH_AGE);
        short = new SessionOracle(stock, keccak256("QQQ"), Side.Short, 18, 6, MAX_FEED_AGE, MAX_PUBLISH_AGE);
    }

    function _set(int128 price, int128 bid, int128 ask, uint8 session, uint256 feedAge, uint256 publishAge) internal {
        source.set(
            IAnchoredStockOracle.PricePayload({
                price: price,
                bestBid: bid,
                bestAsk: ask,
                feedUpdateTimestamp: uint64(block.timestamp - feedAge),
                publishedAt: uint64(block.timestamp - publishAge),
                roundId: 1,
                session: Session(session)
            })
        );
    }

    function testFuzz_longNeverValuesCollateralAboveThePrice(int128 price, int128 bid, int128 ask, uint8 session)
        public
    {
        price = int128(bound(price, 1, MAX_PRICE));
        bid = int128(bound(bid, -1e8, MAX_PRICE));
        ask = int128(bound(ask, -1e8, MAX_PRICE));
        _set(price, bid, ask, uint8(bound(session, 0, 5)), 0, 0);

        uint256 used = long.price() / 1e16;
        assertLe(used, uint256(uint128(price)));
        assertGt(used, 0);
        if (bid > 0 && bid < price) assertEq(used, uint256(uint128(bid)));
        else assertEq(used, uint256(uint128(price)));
    }

    function testFuzz_shortNeverValuesDebtBelowThePrice(int128 price, int128 bid, int128 ask, uint8 session) public {
        price = int128(bound(price, 1, MAX_PRICE));
        bid = int128(bound(bid, -1e8, MAX_PRICE));
        ask = int128(bound(ask, -1e8, MAX_PRICE));
        _set(price, bid, ask, uint8(bound(session, 0, 5)), 0, 0);

        uint256 stockPrice = ask > price ? uint256(uint128(ask)) : uint256(uint128(price));
        assertEq(short.price(), uint256(1e56) / stockPrice);
        assertGt(short.price(), 0);
    }

    function testFuzz_longAndShortAreInverses(int128 price) public {
        price = int128(bound(price, 1, MAX_PRICE));
        _set(price, price, price, uint8(Session.Regular), 0, 0);

        uint256 product = long.price() * short.price();
        assertLe(product, 1e72);
        assertGe(product, 1e72 - long.price());
    }

    function testFuzz_nonPositivePriceAlwaysReverts(int128 price, int128 bid, int128 ask, uint8 session) public {
        price = int128(bound(price, type(int128).min, 0));
        _set(price, bid, ask, uint8(bound(session, 0, 5)), 0, 0);

        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        long.price();
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        short.price();
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        long.snapshot();
    }

    function testFuzz_stalenessFollowsTheRightClock(uint8 session, uint256 feedAge, uint256 publishAge) public {
        session = uint8(bound(session, 0, 5));
        feedAge = bound(feedAge, 0, 30 days);
        publishAge = bound(publishAge, 0, 30 days);
        _set(740e8, 739e8, 741e8, session, feedAge, publishAge);

        bool closed = Session(session) == Session.Closed;
        bool expectedStale = closed ? publishAge > MAX_PUBLISH_AGE : feedAge > MAX_FEED_AGE;
        (,,,,,, bool stale) = long.snapshot();
        assertEq(stale, expectedStale);

        if (expectedStale) {
            vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
            long.price();
            vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
            short.price();
        } else {
            assertEq(long.price(), uint256(739e8) * 1e16);
            assertEq(short.price(), uint256(1e56) / 741e8);
        }
    }

    function testFuzz_aQuoteFromTheFutureIsNotStale(uint64 ahead) public {
        ahead = uint64(bound(ahead, 1, 365 days));
        source.set(
            IAnchoredStockOracle.PricePayload({
                price: 740e8,
                bestBid: 739e8,
                bestAsk: 741e8,
                feedUpdateTimestamp: uint64(block.timestamp) + ahead,
                publishedAt: uint64(block.timestamp) + ahead,
                roundId: 1,
                session: Session.Regular
            })
        );
        assertGt(long.price(), 0);
    }
}
