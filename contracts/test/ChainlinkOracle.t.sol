// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChainlinkSessionOracle} from "../src/ChainlinkSessionOracle.sol";
import {IChainlinkFeed} from "../src/interfaces/IChainlinkFeed.sol";
import {ICoinbaseOracleRegistry} from "../src/interfaces/ICoinbaseOracleRegistry.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Session, Side} from "../src/interfaces/Types.sol";

/// Stands in for a Chainlink feed so any answer and age can be tried. No fork needed.
contract FakeFeed {
    uint8 public decimals = 8;
    int256 internal answer;
    uint256 internal updatedAt;

    function setDecimals(uint8 d) external {
        decimals = d;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

contract FakeRegistry {
    bool internal paused;
    bool internal broken;

    function setPaused(bool p) external {
        paused = p;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function getOracleParams(address) external view returns (uint256, bool) {
        require(!broken, "broken");
        return (1e18, paused);
    }
}

/// Answers getOracleParams with 32 bytes instead of 64, as an upgraded registry might.
contract ShortRegistry {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}

/// Returns as much data as its gas allows, to make a caller that copies return data run out of gas.
contract BombRegistry {
    fallback() external {
        assembly {
            return(0, 100000)
        }
    }
}

contract ChainlinkOracleTest is Test {
    uint64 internal constant MAX_FEED_AGE = 26 hours;
    uint64 internal constant MAX_PUBLISH_AGE = 4 days;
    uint256 internal constant MIN_PRICE = 1e6;
    uint256 internal constant MAX_PRICE = 1e14;
    address internal constant TOKEN = address(0xb200);

    /// Thursday 19 November 2026, 13:20:35 UTC.
    uint256 internal constant THURSDAY = 1_795_090_835;
    uint256 internal constant HOUR = 1 hours;
    uint256 internal constant DAY = 1 days;

    FakeFeed internal feed;
    FakeRegistry internal registry;
    ChainlinkSessionOracle internal long;
    ChainlinkSessionOracle internal short;

    function setUp() public {
        vm.warp(THURSDAY);
        feed = new FakeFeed();
        registry = new FakeRegistry();
        long = _oracle(Side.Long);
        short = _oracle(Side.Short);
        feed.set(15_362_194_489, block.timestamp);
    }

    function _oracle(Side side) internal returns (ChainlinkSessionOracle) {
        return new ChainlinkSessionOracle(
            IChainlinkFeed(address(feed)),
            ICoinbaseOracleRegistry(address(registry)),
            TOKEN,
            side,
            8,
            6,
            MAX_FEED_AGE,
            MAX_PUBLISH_AGE,
            MIN_PRICE,
            MAX_PRICE
        );
    }

    /// Start of the UTC day of `ts`, plus `offset`, on the given weekday (0 Sunday to 6 Saturday).
    function _at(uint256 weekday, uint256 offset) internal pure returns (uint256) {
        uint256 day = THURSDAY / DAY;
        uint256 thursday = 4;
        return (day + weekday + 7 - thursday) * DAY + offset;
    }

    function test_scalesToMorphoUnitsForEightDecimalStockAndUsdc() public view {
        // Morpho's own oracle for the NVDAc market answered exactly feed * 1e26 at the pinned block.
        assertEq(long.price(), 15_362_194_489 * 1e26);
        assertEq(short.price(), uint256(1e46) / 15_362_194_489);
        assertEq(long.priceId(), bytes32(uint256(uint160(address(feed)))));
    }

    function test_weeklyCloseRunsFromSaturdayToMondayOneAmUtc() public view {
        assertFalse(long.isWeeklyClose(_at(5, 24 * HOUR - 1)), "Friday 23:59:59");
        assertTrue(long.isWeeklyClose(_at(6, 0)), "Saturday 00:00");
        assertTrue(long.isWeeklyClose(_at(7, 12 * HOUR)), "Sunday noon");
        assertTrue(long.isWeeklyClose(_at(8, HOUR - 1)), "Monday 00:59:59");
        assertFalse(long.isWeeklyClose(_at(8, HOUR)), "Monday 01:00");
        assertFalse(long.isWeeklyClose(THURSDAY), "Thursday");
    }

    function testFuzz_weeklyCloseMatchesTheCalendar(uint256 ts) public view {
        ts = bound(ts, 0, type(uint64).max);
        uint256 weekday = (ts / DAY + 4) % 7;
        bool expected = weekday == 6 || weekday == 0 || (weekday == 1 && ts % DAY < HOUR);
        assertEq(long.isWeeklyClose(ts), expected);
    }

    function test_openSessionUsesTheFeedAge() public {
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Regular));
        assertFalse(stale);

        feed.set(15_362_194_489, block.timestamp - MAX_FEED_AGE);
        long.price();
        feed.set(15_362_194_489, block.timestamp - MAX_FEED_AGE - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ISessionOracle.OracleStale.selector, uint64(block.timestamp - MAX_FEED_AGE - 1))
        );
        long.price();
        (,,,,,, stale) = long.snapshot();
        assertTrue(stale);
    }

    function test_weeklyCloseCarriesTheFridayPriceOnTheLongerClock() public {
        uint256 friday = _at(5, 21 * HOUR);
        uint256 sunday = _at(7, 23 * HOUR);
        feed.set(15_362_194_489, friday);
        vm.warp(sunday);
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Closed));
        assertFalse(stale);
        assertGt(long.price(), 0);

        vm.warp(friday + MAX_PUBLISH_AGE + 1);
        assertFalse(long.isWeeklyClose(block.timestamp));
        vm.expectRevert();
        long.price();
    }

    function test_issuerPauseRefusesOpensButKeepsThePriceForClosing() public {
        registry.setPaused(true);
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Unknown));
        assertTrue(stale);

        feed.set(15_362_194_489, block.timestamp - 3 days);
        assertEq(long.price(), 15_362_194_489 * 1e26);
        feed.set(15_362_194_489, block.timestamp - MAX_PUBLISH_AGE - 1);
        vm.expectRevert();
        long.price();
    }

    /// Review 4: an unreadable registry refuses opens but never loosens the hard price to the closed clock.
    function test_unreadableRegistryRefusesOpensButKeepsTheOpenClock() public {
        registry.setBroken(true);
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Unknown));
        assertTrue(stale);
        assertEq(long.price(), 15_362_194_489 * 1e26);
        feed.set(15_362_194_489, block.timestamp - 3 days);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        long.price();
    }

    function test_malformedOrMissingRegistryCountsAsPausedAndNeverBlocksThePrice() public {
        address[3] memory registries = [address(new ShortRegistry()), address(0xDEAD), address(new BombRegistry())];
        for (uint256 i; i < registries.length; ++i) {
            ChainlinkSessionOracle o = new ChainlinkSessionOracle(
                IChainlinkFeed(address(feed)),
                ICoinbaseOracleRegistry(registries[i]),
                TOKEN,
                Side.Long,
                8,
                6,
                MAX_FEED_AGE,
                MAX_PUBLISH_AGE,
                MIN_PRICE,
                MAX_PRICE
            );
            if (i < 2) {
                (,,, Session session,,, bool stale) = o.snapshot();
                assertEq(uint8(session), uint8(Session.Unknown), "short or missing data counts as paused");
                assertTrue(stale);
            }
            uint256 before = gasleft();
            assertEq(o.price(), 15_362_194_489 * 1e26);
            assertLt(before - gasleft(), 200_000, "a hostile registry must not spend the caller's gas");
        }
    }

    /// D-92: a Monday holiday stops the price once the weekly close ends (fail closed), until the feed writes.
    function test_mondayHolidayStopsThePriceUntilTheFeedWrites() public {
        feed.set(15_362_194_489, _at(5, 21 * HOUR));
        vm.warp(_at(8, 12 * HOUR));
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Regular));
        assertTrue(stale);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        long.price();
        feed.set(15_362_194_489, block.timestamp);
        assertGt(long.price(), 0);
    }

    /// Summer: the Sunday 20:00 New York write lands at Monday 00:00 UTC, inside the weekly close.
    function test_summerMondayWriteAtMidnightReopensAtOneUtc() public {
        feed.set(15_362_194_489, _at(8, 5));
        vm.warp(_at(8, 2 * HOUR));
        (,,, Session session,,, bool stale) = long.snapshot();
        assertEq(uint8(session), uint8(Session.Regular));
        assertFalse(stale);
    }

    function test_noRegistryMeansNoPause() public {
        ChainlinkSessionOracle bare = new ChainlinkSessionOracle(
            IChainlinkFeed(address(feed)),
            ICoinbaseOracleRegistry(address(0)),
            address(0),
            Side.Long,
            8,
            6,
            MAX_FEED_AGE,
            MAX_PUBLISH_AGE,
            MIN_PRICE,
            MAX_PRICE
        );
        (,,, Session session,,, bool stale) = bare.snapshot();
        assertEq(uint8(session), uint8(Session.Regular));
        assertFalse(stale);
    }

    function test_rejectsBrokenAnswers() public {
        int256[5] memory bad = [int256(0), -1, int256(MIN_PRICE) - 1, int256(MAX_PRICE) + 1, int256(1)];
        for (uint256 i; i < bad.length; ++i) {
            feed.set(bad[i], block.timestamp);
            vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
            long.price();
            vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
            long.snapshot();
        }
        feed.set(15_362_194_489, 0);
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        long.price();
        feed.set(15_362_194_489, block.timestamp + 1);
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        long.price();
    }

    function test_constructorRefusesBadSetups() public {
        feed.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkSessionOracle.FeedDecimalsNot8.selector, uint8(18)));
        _oracle(Side.Long);
        feed.setDecimals(8);

        vm.expectRevert(ChainlinkSessionOracle.InvalidPriceBounds.selector);
        new ChainlinkSessionOracle(
            IChainlinkFeed(address(feed)),
            ICoinbaseOracleRegistry(address(registry)),
            TOKEN,
            Side.Long,
            8,
            6,
            1,
            1,
            0,
            1
        );
        vm.expectRevert(ChainlinkSessionOracle.InvalidPriceBounds.selector);
        new ChainlinkSessionOracle(
            IChainlinkFeed(address(feed)),
            ICoinbaseOracleRegistry(address(registry)),
            TOKEN,
            Side.Long,
            8,
            6,
            1,
            1,
            5,
            5
        );
        vm.expectRevert(ChainlinkSessionOracle.RegistryWithoutToken.selector);
        new ChainlinkSessionOracle(
            IChainlinkFeed(address(feed)),
            ICoinbaseOracleRegistry(address(registry)),
            address(0),
            Side.Long,
            8,
            6,
            1,
            1,
            1,
            2
        );
    }

    function testFuzz_longValueIsThePriceAndShortIsItsInverse(uint256 p, uint256 age, bool paused, uint8 dayOfWeek)
        public
    {
        p = bound(p, MIN_PRICE, MAX_PRICE);
        vm.warp(_at(bound(dayOfWeek, 0, 6) + 4, 12 * HOUR));
        age = bound(age, 0, MAX_FEED_AGE);
        registry.setPaused(paused);
        feed.set(int256(p), block.timestamp - age);
        assertEq(long.price(), p * 1e26);
        assertEq(short.price(), uint256(1e46) / p);
        (uint256 priceE8, uint256 bid, uint256 ask,,,,) = long.snapshot();
        assertEq(priceE8, p);
        assertEq(bid, 0);
        assertEq(ask, 0);
    }
}

/// The adapter against the real Coinbase NVDA feed and the Coinbase oracle registry on Base.
/// The registry reads the stock token, a precompile that a fork cannot run, so on a fork the
/// registry reverts. One test checks that path; the others answer the registry as the live node
/// did at the pinned block (not paused, multiplier 1.000538 for NVDAc).
contract ChainlinkOracleBaseForkTest is Test {
    address internal constant NVDA_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address internal constant REGISTRY = 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD;
    address internal constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address internal constant MORPHO_NVDAC_ORACLE = 0x4F698C04d01d9CebCDd9494c189aBdD6C5453f84;
    uint256 internal constant NVDAC_MULTIPLIER = 1_000_537_939_576_369_481;
    /// Thursday 19 November 2026, 13:20:35 UTC.
    uint256 internal constant WEEKDAY_BLOCK = 59_520_298;
    /// Sunday 15 November 2026, 14:00:58 UTC, inside the weekly close.
    uint256 internal constant WEEKEND_BLOCK = 57_804_412;

    function _fork(uint256 blockNumber, bool answerRegistry) internal {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")), blockNumber);
        if (answerRegistry) {
            vm.mockCall(
                REGISTRY,
                abi.encodeCall(ICoinbaseOracleRegistry.getOracleParams, (NVDAC)),
                abi.encode(NVDAC_MULTIPLIER, false)
            );
        }
    }

    function _oracle() internal returns (ChainlinkSessionOracle) {
        return new ChainlinkSessionOracle(
            IChainlinkFeed(NVDA_FEED),
            ICoinbaseOracleRegistry(REGISTRY),
            NVDAC,
            Side.Long,
            8,
            6,
            26 hours,
            4 days,
            1e6,
            1e14
        );
    }

    function test_matchesMorphoOwnOracleOnAWeekday() public {
        _fork(WEEKDAY_BLOCK, true);
        ChainlinkSessionOracle oracle = _oracle();
        assertEq(oracle.price(), ISessionOracle(MORPHO_NVDAC_ORACLE).price());
        (uint256 priceE8,,, Session session,,, bool stale) = oracle.snapshot();
        assertEq(priceE8, 15_362_194_489);
        assertEq(uint8(session), uint8(Session.Regular));
        assertFalse(stale);
    }

    function test_carriesTheFridayPriceOverTheWeekend() public {
        _fork(WEEKEND_BLOCK, true);
        ChainlinkSessionOracle oracle = _oracle();
        (,,, Session session, uint64 feedUpdatedAt,, bool stale) = oracle.snapshot();
        assertEq(uint8(session), uint8(Session.Closed));
        assertFalse(stale);
        assertGt(block.timestamp - feedUpdatedAt, 26 hours, "the feed is frozen for longer than the open clock allows");
        assertEq(oracle.price(), ISessionOracle(MORPHO_NVDAC_ORACLE).price());
    }

    function test_aRegistryThatRevertsStillLeavesThePrice() public {
        _fork(WEEKDAY_BLOCK, false);
        ChainlinkSessionOracle oracle = _oracle();
        (,,, Session session,,, bool stale) = oracle.snapshot();
        assertEq(uint8(session), uint8(Session.Unknown));
        assertTrue(stale);
        uint256 before = gasleft();
        assertEq(oracle.price(), ISessionOracle(MORPHO_NVDAC_ORACLE).price());
        assertLt(before - gasleft(), 200_000, "a failing registry must not use up the caller's gas");
    }
}
