// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAnchoredStockOracle} from "../src/interfaces/IAnchoredStockOracle.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {ILens} from "../src/interfaces/ILens.sol";
import {Session} from "../src/interfaces/Types.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {BaseTest} from "./Base.t.sol";

contract RiskTest is BaseTest {
    // ----- oracle -----

    function test_openMarketPriceGoesStaleOnTheSourceQuoteTime() public {
        _mockOracle(Session.Regular, 2 hours + 1, 0, 740e8);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        longOracle.price();
        (,,,,,, bool stale) = longOracle.snapshot();
        assertTrue(stale);
    }

    function test_closedMarketAcceptsTheCarriedPrice() public {
        _mockOracle(Session.Closed, 3 days, 5 minutes, 740e8);
        assertEq(longOracle.price(), (740e8 - 5e6) * 1e16);
        (,,,,,, bool stale) = longOracle.snapshot();
        assertFalse(stale);
    }

    function test_closedMarketGoesStaleWhenTheHeartbeatStops() public {
        _mockOracle(Session.Closed, 5 days, 4 days + 1, 740e8);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        longOracle.price();
    }

    function test_nonPositivePriceIsRejected() public {
        _mockOracle(Session.Regular, 0, 0, 0);
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        longOracle.price();
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        shortOracle.price();
    }

    function test_negativePriceIsRejected() public {
        _mockOracle(Session.Regular, 0, 0, -1);
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        longOracle.price();
        vm.expectRevert(ISessionOracle.InvalidOraclePrice.selector);
        longOracle.snapshot();
    }

    function test_missingBidFallsBackToThePrice() public {
        IAnchoredStockOracle.PricePayload memory payload = IAnchoredStockOracle.PricePayload({
            price: 740e8,
            bestBid: 0,
            bestAsk: 0,
            feedUpdateTimestamp: uint64(vm.getBlockTimestamp()),
            publishedAt: uint64(vm.getBlockTimestamp()),
            roundId: 1,
            session: Session.Regular
        });
        vm.mockCall(address(STOCK_ORACLE), abi.encodeCall(IAnchoredStockOracle.latestPrice, (QQQ)), abi.encode(payload));
        assertEq(longOracle.price(), 740e8 * 1e16);
        assertEq(shortOracle.price(), uint256(1e56) / 740e8);
    }

    function test_shortOracleUsesTheAsk() public {
        _mockOracle(Session.Regular, 0, 0, 740e8);
        assertEq(shortOracle.price(), uint256(1e56) / (740e8 + 5e6));
    }

    // ----- soft limit by session -----

    function test_softLimitIsStricterWhenTheMarketIsClosed() public {
        _mockOracle(Session.Closed, 1 days, 5 minutes, 740e8);
        assertEq(risk.currentSoftLtv(longId), SOFT_CLOSED);
        assertTrue(risk.isClosedRegime());

        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 257e6, 0);
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.SoftLimitExceeded.selector);
        router.openLong(p);
    }

    function test_unknownSessionCountsAsClosed() public {
        _mockOracle(Session.Unknown, 0, 0, 740e8);
        assertEq(risk.currentSoftLtv(longId), SOFT_CLOSED);
    }

    function test_openingNeedsAFresherPriceThanTheHardLimit() public {
        IRiskManager.MarketConfig memory c = _config(risk.config(longId).side, address(longOracle));
        c.maxOracleAge = 30 minutes;
        risk.setMarketConfig(longId, c);
        _mockOracle(Session.Regular, 31 minutes, 0, 740e8);

        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 100e6, 0);
        vm.prank(user);
        vm.expectPartialRevert(IRiskManager.OracleStale.selector);
        router.openLong(p);
    }

    // ----- roles -----

    function test_guardianCanOnlyTighten() public {
        address guardian = makeAddr("guardian");
        risk.setGuardian(guardian);

        vm.startPrank(guardian);
        risk.tightenMarket(longId, 0.7e18, 0.65e18, 1_000e6);
        assertEq(risk.currentSoftLtv(longId), 0.7e18);
        vm.expectRevert(RiskManager.NotTightening.selector);
        risk.tightenMarket(longId, 0.71e18, 0.65e18, 1_000e6);
        vm.expectRevert(RiskManager.NotTightening.selector);
        risk.tightenMarket(longId, 0.7e18, 0.65e18, 1_001e6);
        vm.stopPrank();
    }

    function test_guardianCanPauseButNotResume() public {
        address guardian = makeAddr("guardian");
        risk.setGuardian(guardian);
        vm.prank(guardian);
        risk.setOpeningPaused(true);
        assertTrue(risk.openingPaused());
        vm.prank(guardian);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setOpeningPaused(false);
        risk.setOpeningPaused(false);
        assertFalse(risk.openingPaused());
    }

    function test_strangersCannotChangeAnything() public {
        IRiskManager.MarketConfig memory c = _config(risk.config(longId).side, address(longOracle));
        vm.startPrank(makeAddr("stranger"));
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.tightenMarket(longId, 0.1e18, 0.1e18, 1);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setOpeningPaused(true);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + 1 hours));
        vm.expectRevert();
        risk.setMarketConfig(longId, c);
        vm.expectRevert();
        router.setFees(50, 30, address(1));
        vm.expectRevert();
        router.setKeeper(address(1), true);
        vm.stopPrank();
    }

    function test_closeTimeMustBeInTheNearFuture() public {
        vm.expectRevert(RiskManager.InvalidCloseTime.selector);
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp()));
        vm.expectRevert(RiskManager.InvalidCloseTime.selector);
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + 8 days + 1));
        risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + 8 days));
    }

    function test_softLimitMustStayBelowTheHardLimit() public {
        IRiskManager.MarketConfig memory c = _config(risk.config(longId).side, address(longOracle));
        c.softLtvOpen = uint64(LLTV);
        vm.expectRevert(RiskManager.InvalidConfig.selector);
        risk.setMarketConfig(longId, c);
        c.softLtvOpen = SOFT_OPEN;
        c.oracle = address(shortOracle);
        vm.expectRevert(RiskManager.InvalidConfig.selector);
        risk.setMarketConfig(longId, c);
    }

    function test_feesAreCapped() public {
        vm.expectRevert();
        router.setFees(51, 30, feeRecipient);
        vm.expectRevert();
        router.setFees(50, 31, feeRecipient);
        router.setFees(50, 30, feeRecipient);
    }

    // ----- oracle age poster -----

    function test_posterMovesTheOracleAgeOnlyInsideTheOwnersBounds() public {
        address poster = makeAddr("poster");
        risk.setOracleAgePoster(poster);
        risk.setOracleAgeBounds(longId, 25 minutes, 1 hours);

        vm.startPrank(poster);
        risk.setMaxOracleAge(longId, 35 minutes);
        assertEq(risk.config(longId).maxOracleAge, 35 minutes);
        risk.setMaxOracleAge(longId, 1 hours);
        vm.expectPartialRevert(IRiskManager.OracleAgeOutOfBounds.selector);
        risk.setMaxOracleAge(longId, 1 hours + 1);
        vm.expectPartialRevert(IRiskManager.OracleAgeOutOfBounds.selector);
        risk.setMaxOracleAge(longId, 25 minutes - 1);
        vm.stopPrank();
        assertEq(risk.config(longId).maxOracleAge, 1 hours);
    }

    function test_posterCanDoNothingWithoutBounds() public {
        address poster = makeAddr("poster");
        risk.setOracleAgePoster(poster);
        vm.prank(poster);
        vm.expectPartialRevert(IRiskManager.OracleAgeOutOfBounds.selector);
        risk.setMaxOracleAge(longId, 30 minutes);
    }

    function test_posterCannotChangeAnythingElse() public {
        address poster = makeAddr("poster");
        risk.setOracleAgePoster(poster);
        risk.setOracleAgeBounds(longId, 25 minutes, 1 hours);
        IRiskManager.MarketConfig memory c = risk.config(longId);

        vm.startPrank(poster);
        vm.expectRevert();
        risk.setOracleAgeBounds(longId, 0, 2 hours);
        vm.expectRevert();
        risk.setMarketConfig(longId, c);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.tightenMarket(longId, 0.1e18, 0.1e18, 1);
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setOpeningPaused(true);
        vm.stopPrank();

        vm.prank(makeAddr("stranger"));
        vm.expectRevert(IRiskManager.Unauthorized.selector);
        risk.setMaxOracleAge(longId, 30 minutes);
    }

    function test_boundsCannotExceedTheHardOracleAge() public {
        // The test oracles accept a source quote up to two hours old.
        vm.expectRevert(RiskManager.InvalidConfig.selector);
        risk.setOracleAgeBounds(longId, 25 minutes, 2 hours + 1);
        vm.expectRevert(RiskManager.InvalidConfig.selector);
        risk.setOracleAgeBounds(longId, 1 hours, 30 minutes);
        risk.setOracleAgeBounds(longId, 25 minutes, 2 hours);
        (uint32 min, uint32 cap) = risk.oracleAgeBounds(longId);
        assertEq(min, 25 minutes);
        assertEq(cap, 2 hours);
    }

    // ----- lens -----

    function test_lensListsBothMarkets() public view {
        ILens.MarketView[] memory markets = lens.getMarkets();
        assertEq(markets.length, 2);
        assertEq(markets[0].lltv, LLTV);
        assertEq(markets[0].currentSoftLtv, SOFT_OPEN);
        assertEq(markets[0].totalSupplyAssets, 100_000e6);
        assertGt(markets[0].priceE8, 0);
        assertGt(markets[0].feedUpdatedAt, 0);
        assertFalse(markets[0].stale);
        assertEq(markets[1].totalSupplyAssets, 100e18);
    }

    // ----- one confirmation on first use -----

    function test_firstUseInOneTransactionWithTwoSignatures() public {
        uint256 key = 0xB0B;
        address newcomer = vm.addr(key);
        deal(address(USDC), newcomer, 500e6);
        uint256 deadline = vm.getBlockTimestamp() + 1 hours;

        (uint8 pv, bytes32 pr, bytes32 ps) = _signPermit(key, address(router), 100e6, 0, deadline);
        (uint8 av, bytes32 ar, bytes32 as_) = _signAuthorization(key, address(router), true, 0, deadline);

        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(IMarginRouter.permitToken, (address(USDC), 100e6, deadline, pv, pr, ps));
        calls[1] = abi.encodeCall(IMarginRouter.authorizeWithSig, (newcomer, true, 0, deadline, av, ar, as_));
        calls[2] = abi.encodeCall(IMarginRouter.openLong, (_openLongParams(100e6, 100e6, 0)));

        vm.prank(newcomer);
        router.multicall(calls);

        assertGt(MORPHO.position(longId, newcomer).collateral, 0);
        assertEq(USDC.balanceOf(newcomer), 400e6);
        assertEq(USDC.allowance(newcomer, address(router)), 0);
        _assertRouterEmpty();
    }

    function test_cannotAuthorizeOnBehalfOfSomeoneElse() public {
        vm.expectRevert(IMarginRouter.Unauthorized.selector);
        router.authorizeWithSig(user, true, 0, vm.getBlockTimestamp() + 1, 27, bytes32(0), bytes32(0));
    }
}
