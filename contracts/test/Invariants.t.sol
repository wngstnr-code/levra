// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Id, IMorpho, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {Session, Swap} from "../src/interfaces/Types.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {BaseTest, TestSwapper} from "./Base.t.sol";

interface OracleMocker {
    function mockOracle(Session session, uint256 feedAge, uint256 publishAge, int128 price) external;
}

/// Random users, a keeper and a moving price act on the router. Reverts are expected and ignored.
contract Handler is Test {
    IMorpho internal immutable MORPHO;
    MarginRouter internal immutable router;
    RiskManager internal immutable risk;
    TestSwapper internal immutable swapper;
    IERC20 internal immutable USDC;
    IERC20 internal immutable STOCK;
    Id internal immutable longId;
    Id internal immutable shortId;
    address internal immutable keeper;
    OracleMocker internal immutable mocker;

    address[] public actors;
    int128 public price = 740e8;
    uint256 public opens;
    uint256 public closes;
    uint256 public reductions;
    /// Set when an open succeeded above the soft limit of that moment. Must stay false.
    bool public openedAboveSoftLimit;

    constructor(
        IMorpho morpho,
        MarginRouter router_,
        RiskManager risk_,
        TestSwapper swapper_,
        IERC20 usdc,
        IERC20 stock,
        Id longId_,
        Id shortId_,
        address keeper_,
        address[] memory actors_,
        OracleMocker mocker_
    ) {
        MORPHO = morpho;
        router = router_;
        risk = risk_;
        swapper = swapper_;
        USDC = usdc;
        STOCK = stock;
        longId = longId_;
        shortId = shortId_;
        keeper = keeper_;
        actors = actors_;
        mocker = mocker_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _stockFor(uint256 usdc, uint256 fillBps) internal view returns (uint256) {
        return usdc * 1e20 / uint256(uint128(price)) * fillBps / 10_000;
    }

    function _usdcFor(uint256 stock, uint256 fillBps) internal view returns (uint256) {
        return stock * uint256(uint128(price)) / 1e20 * fillBps / 10_000;
    }

    function _swap(IERC20 tokenIn, IERC20 tokenOut, uint256 amountIn, uint256 amountOut)
        internal
        view
        returns (Swap memory)
    {
        return Swap(
            address(swapper), abi.encodeCall(TestSwapper.swap, (tokenIn, tokenOut, amountIn, amountOut)), amountOut
        );
    }

    function openLong(uint256 actorSeed, uint256 margin, uint256 leverageE2, uint256 fillBps) external {
        address actor = _actor(actorSeed);
        margin = bound(margin, 10e6, 400e6);
        leverageE2 = bound(leverageE2, 100, 420);
        fillBps = bound(fillBps, 9_700, 10_300);
        uint256 gross = margin * leverageE2 / 100;
        uint256 swapIn = gross - gross * router.feeBps() / 10_000;
        IMarginRouter.OpenParams memory p = IMarginRouter.OpenParams({
            marketId: longId,
            margin: margin,
            borrowAssets: gross - margin,
            swap: _swap(USDC, STOCK, swapIn, _stockFor(swapIn, fillBps)),
            maxLtv: 1e18,
            deadline: vm.getBlockTimestamp() + 60
        });
        uint256 soft = risk.currentSoftLtv(longId);
        vm.prank(actor);
        try router.openLong(p) returns (uint256, uint256 ltv) {
            ++opens;
            if (ltv > soft) openedAboveSoftLimit = true;
        } catch {}
    }

    function openShort(uint256 actorSeed, uint256 margin, uint256 leverageE2, uint256 fillBps) external {
        address actor = _actor(actorSeed);
        margin = bound(margin, 10e6, 400e6);
        leverageE2 = bound(leverageE2, 10, 300);
        fillBps = bound(fillBps, 9_700, 10_300);
        uint256 borrow = _stockFor(margin * leverageE2 / 100, 10_000);
        IMarginRouter.OpenParams memory p = IMarginRouter.OpenParams({
            marketId: shortId,
            margin: margin,
            borrowAssets: borrow,
            swap: _swap(STOCK, USDC, borrow, _usdcFor(borrow, fillBps)),
            maxLtv: 1e18,
            deadline: vm.getBlockTimestamp() + 60
        });
        uint256 soft = risk.currentSoftLtv(shortId);
        vm.prank(actor);
        try router.openShort(p) returns (uint256, uint256 ltv) {
            ++opens;
            if (ltv > soft) openedAboveSoftLimit = true;
        } catch {}
    }

    function closeLong(uint256 actorSeed, uint256 fractionBps, uint256 fillBps) external {
        address actor = _actor(actorSeed);
        Position memory position = MORPHO.position(longId, actor);
        if (position.collateral == 0) return;
        fractionBps = bound(fractionBps, 500, 10_000);
        fillBps = bound(fillBps, 9_700, 10_300);
        bool full = fractionBps == 10_000;
        uint256 sell = full ? position.collateral : uint256(position.collateral) * fractionBps / 10_000;
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: full ? type(uint256).max : uint256(position.borrowShares) * fractionBps / 10_000,
            withdrawAssets: full ? type(uint256).max : sell,
            swapAmountIn: sell,
            swap: _swap(STOCK, USDC, sell, _usdcFor(sell, fillBps)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(actor);
        try router.closeLong(p) {
            ++closes;
        } catch {}
    }

    function closeShort(uint256 actorSeed, uint256 fillBps) external {
        address actor = _actor(actorSeed);
        Position memory position = MORPHO.position(shortId, actor);
        if (position.borrowShares == 0) return;
        fillBps = bound(fillBps, 9_700, 10_300);
        uint256 debt = uint256(position.borrowShares) * MORPHO.market(shortId).totalBorrowAssets
            / MORPHO.market(shortId).totalBorrowShares;
        uint256 buy = debt * 101 / 100 + 1e12;
        uint256 spend = _usdcFor(buy, 20_000 - fillBps) + 1;
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: shortId,
            repayShares: type(uint256).max,
            withdrawAssets: type(uint256).max,
            swapAmountIn: spend,
            swap: _swap(USDC, STOCK, spend, buy),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(actor);
        try router.closeShort(p) {
            ++closes;
        } catch {}
    }

    function moveCollateral(uint256 actorSeed, uint256 amount, bool add) external {
        address actor = _actor(actorSeed);
        Position memory position = MORPHO.position(longId, actor);
        vm.startPrank(actor);
        if (add) {
            try router.addCollateral(longId, bound(amount, 1, 1e17)) {} catch {}
        } else if (position.collateral > 0) {
            try router.removeCollateral(longId, bound(amount, 1, position.collateral)) {} catch {}
        }
        vm.stopPrank();
    }

    function toggleProtection(uint256 actorSeed, bool enabled) external {
        vm.prank(_actor(actorSeed));
        router.setProtection(longId, enabled);
    }

    /// The keeper tries to reduce anyone, protected or not, at any fill.
    function deleverage(uint256 actorSeed, uint256 fractionBps, uint256 fillBps) external {
        address target = _actor(actorSeed);
        Position memory position = MORPHO.position(longId, target);
        if (position.collateral == 0) return;
        fractionBps = bound(fractionBps, 100, 5_000);
        fillBps = bound(fillBps, 9_000, 10_300);
        uint256 sell = uint256(position.collateral) * fractionBps / 10_000;
        IMarginRouter.CloseParams memory p = IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: uint256(position.borrowShares) * fractionBps / 10_500,
            withdrawAssets: sell,
            swapAmountIn: sell,
            swap: _swap(STOCK, USDC, sell, _usdcFor(sell, fillBps)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
        uint256 ltvBefore = risk.positionLtv(longId, target);
        bool consent = router.protectionEnabled(target, longId);
        uint256 soft = risk.currentSoftLtv(longId);
        vm.prank(keeper);
        try router.deleverage(target, p) {
            ++reductions;
            assertTrue(consent, "reduced without consent");
            assertGt(ltvBefore, soft, "reduced a position within the soft limit");
            assertLt(risk.positionLtv(longId, target), ltvBefore, "reduction did not lower the LTV");
        } catch {}
    }

    function movePrice(uint256 seed) external {
        int128 next = int128(int256(bound(seed, 660e8, 820e8)));
        price = next;
        mocker.mockOracle(Session.Regular, 0, 0, next);
    }

    function enterPreClose(uint256 delay) external {
        try risk.setNextCloseAt(uint64(vm.getBlockTimestamp() + bound(delay, 10 minutes, 7 days))) {} catch {}
    }

    function pass(uint256 time) external {
        vm.warp(vm.getBlockTimestamp() + bound(time, 1 minutes, 6 hours));
        mocker.mockOracle(Session.Regular, 0, 0, price);
    }
}

contract InvariantsTest is BaseTest {
    Handler internal handler;
    address internal bystander = makeAddr("bystander");
    Position internal bystanderPosition;
    uint256 internal bystanderUsdc;

    function setUp() public override {
        super.setUp();
        _mockOracle(Session.Regular, 0, 0, 740e8);

        address[] memory actors = new address[](3);
        for (uint256 i; i < actors.length; ++i) {
            actors[i] = makeAddr(string.concat("actor", vm.toString(i)));
            _prepare(actors[i]);
        }

        // The bystander gives the router every permission and then never acts again.
        _prepare(bystander);
        IMarginRouter.OpenParams memory p = _openLongParams(100e6, 150e6, 0);
        vm.prank(bystander);
        router.openLong(p);
        bystanderPosition = MORPHO.position(longId, bystander);
        bystanderUsdc = USDC.balanceOf(bystander);

        handler = new Handler(
            MORPHO, router, risk, swapper, USDC, AQQQ, longId, shortId, keeper, actors, OracleMocker(address(this))
        );
        risk.setCalendarPoster(address(handler));
        targetContract(address(handler));
    }

    function mockOracle(Session session, uint256 feedAge, uint256 publishAge, int128 price) external {
        _mockOracle(session, feedAge, publishAge, price);
    }

    function _prepare(address who) internal {
        deal(address(USDC), who, 5_000e6);
        deal(address(AQQQ), who, 1e18);
        vm.startPrank(who);
        USDC.approve(address(router), type(uint256).max);
        AQQQ.approve(address(router), type(uint256).max);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
    }

    function invariant_routerHoldsNoTokens() public view {
        _assertRouterEmpty();
    }

    function invariant_nobodyCanTouchAPositionOfSomeoneElse() public view {
        Position memory position = MORPHO.position(longId, bystander);
        assertEq(position.collateral, bystanderPosition.collateral);
        assertEq(position.borrowShares, bystanderPosition.borrowShares);
        assertEq(USDC.balanceOf(bystander), bystanderUsdc);
        assertEq(MORPHO.position(shortId, bystander).borrowShares, 0);
    }

    function invariant_noOpenEndsAboveTheSoftLimit() public view {
        assertFalse(handler.openedAboveSoftLimit());
    }

    function invariant_softLimitStaysBelowTheHardLimit() public view {
        assertLt(risk.currentSoftLtv(longId), LLTV);
        assertLt(risk.currentSoftLtv(shortId), LLTV);
    }

    function invariant_feesStayWithinTheirCaps() public view {
        assertLe(router.feeBps(), router.MAX_FEE_BPS());
        assertLe(router.keeperFeeBps(), router.MAX_KEEPER_FEE_BPS());
    }

    /// Printed once per run, to show that the campaign really opened, closed and reduced positions.
    function afterInvariant() public view {
        console.log("opens", handler.opens(), "closes", handler.closes());
        console.log("keeper reductions", handler.reductions());
    }
}
