// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {Authorization, Id, IMorpho, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {IAnchoredStockOracle} from "../src/interfaces/IAnchoredStockOracle.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {Session, Side, Swap} from "../src/interfaces/Types.sol";
import {Lens} from "../src/Lens.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {SessionOracle} from "../src/SessionOracle.sol";

/// Stands in for the swap aggregator in tests. Trades at whatever amounts the caller asks for.
contract TestSwapper {
    function swap(IERC20 tokenIn, IERC20 tokenOut, uint256 amountIn, uint256 amountOut) external {
        tokenIn.transferFrom(msg.sender, address(this), amountIn);
        tokenOut.transfer(msg.sender, amountOut);
    }
}

/// Runs against a fork of Monad mainnet: real Morpho, real Anchored oracle, real tokens.
abstract contract BaseTest is Test {
    using MarketParamsLib for MarketParams;

    IMorpho internal constant MORPHO = IMorpho(0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee);
    address internal constant IRM = 0x09475a3D6eA8c314c592b1a3799bDE044E2F400F;
    IAnchoredStockOracle internal constant STOCK_ORACLE =
        IAnchoredStockOracle(0x037848af338C38e1e0AB722bE80BF4C2E612a1F7);
    IERC20 internal constant USDC = IERC20(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);
    IERC20 internal constant AQQQ = IERC20(0x1446501E886c7f830DB9b494A1890cBCCC072f57);
    bytes32 internal constant QQQ = keccak256("QQQ");

    uint256 internal constant LLTV = 0.77e18;
    uint64 internal constant SOFT_OPEN = 0.73e18;
    uint64 internal constant SOFT_CLOSED = 0.7e18;

    SessionOracle internal longOracle;
    SessionOracle internal shortOracle;
    RiskManager internal risk;
    MarginRouter internal router;
    Lens internal lens;
    TestSwapper internal swapper;

    MarketParams internal longMarket;
    MarketParams internal shortMarket;
    Id internal longId;
    Id internal shortId;

    address internal feeRecipient = makeAddr("feeRecipient");
    address internal lender = makeAddr("lender");
    address internal keeper = makeAddr("keeper");
    uint256 internal userKey = 0xA11CE;
    address internal user = vm.addr(userKey);

    function setUp() public virtual {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc2.monad.xyz")));

        longOracle = new SessionOracle(STOCK_ORACLE, QQQ, Side.Long, 18, 6, 2 hours, 4 days);
        shortOracle = new SessionOracle(STOCK_ORACLE, QQQ, Side.Short, 18, 6, 2 hours, 4 days);
        longMarket = MarketParams(address(USDC), address(AQQQ), address(longOracle), IRM, LLTV);
        shortMarket = MarketParams(address(AQQQ), address(USDC), address(shortOracle), IRM, LLTV);
        MORPHO.createMarket(longMarket);
        MORPHO.createMarket(shortMarket);
        longId = longMarket.id();
        shortId = shortMarket.id();

        swapper = new TestSwapper();
        risk = new RiskManager(MORPHO, address(this), 4 hours);
        router = new MarginRouter(MORPHO, risk, address(swapper), address(this), feeRecipient, 10);
        lens = new Lens(MORPHO, risk, router);

        risk.setMarketConfig(longId, _config(Side.Long, address(longOracle)));
        risk.setMarketConfig(shortId, _config(Side.Short, address(shortOracle)));
        router.setKeeper(keeper, true);
        router.setFees(10, 30, feeRecipient);

        deal(address(USDC), address(swapper), 1_000_000e6);
        deal(address(AQQQ), address(swapper), 1_000e18);
        deal(address(USDC), lender, 100_000e6);
        deal(address(AQQQ), lender, 100e18);
        deal(address(USDC), user, 10_000e6);

        vm.startPrank(lender);
        USDC.approve(address(MORPHO), type(uint256).max);
        AQQQ.approve(address(MORPHO), type(uint256).max);
        MORPHO.supply(longMarket, 100_000e6, 0, lender, "");
        MORPHO.supply(shortMarket, 100e18, 0, lender, "");
        vm.stopPrank();

        vm.startPrank(user);
        USDC.approve(address(router), type(uint256).max);
        MORPHO.setAuthorization(address(router), true);
        vm.stopPrank();
    }

    function _config(Side side, address oracle) internal pure returns (IRiskManager.MarketConfig memory) {
        return IRiskManager.MarketConfig({
            enabled: true,
            side: side,
            oracle: oracle,
            softLtvOpen: SOFT_OPEN,
            softLtvClosed: SOFT_CLOSED,
            maxDeviationBps: 500,
            maxOracleAge: 2 hours,
            maxPositionUsd: 5_000e6
        });
    }

    function _priceE8() internal view returns (uint256 priceE8) {
        (priceE8,,,,,,) = longOracle.snapshot();
    }

    /// Stock received for a USDC amount at the oracle price, shifted by bps (positive is a better fill).
    function _stockFor(uint256 usdc, int256 bps) internal view returns (uint256) {
        uint256 atOracle = usdc * 1e20 / _priceE8();
        return atOracle * uint256(10_000 + bps) / 10_000;
    }

    function _usdcFor(uint256 stock, int256 bps) internal view returns (uint256) {
        uint256 atOracle = stock * _priceE8() / 1e20;
        return atOracle * uint256(10_000 + bps) / 10_000;
    }

    function _swapData(IERC20 tokenIn, IERC20 tokenOut, uint256 amountIn, uint256 amountOut)
        internal
        view
        returns (Swap memory)
    {
        return Swap(
            address(swapper), abi.encodeCall(TestSwapper.swap, (tokenIn, tokenOut, amountIn, amountOut)), amountOut
        );
    }

    function _openLongParams(uint256 margin, uint256 borrow, int256 fillBps)
        internal
        view
        returns (IMarginRouter.OpenParams memory)
    {
        uint256 swapIn = margin + borrow - (margin + borrow) * router.feeBps() / 10_000;
        return IMarginRouter.OpenParams({
            marketId: longId,
            margin: margin,
            borrowAssets: borrow,
            swap: _swapData(USDC, AQQQ, swapIn, _stockFor(swapIn, fillBps)),
            maxLtv: SOFT_OPEN,
            deadline: block.timestamp + 60
        });
    }

    function _openLong(uint256 margin, uint256 borrow) internal returns (uint256 collateral) {
        IMarginRouter.OpenParams memory p = _openLongParams(margin, borrow, 0);
        vm.prank(user);
        (collateral,) = router.openLong(p);
    }

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    bytes32 internal constant AUTHORIZATION_TYPEHASH = keccak256(
        "Authorization(address authorizer,address authorized,bool isAuthorized,uint256 nonce,uint256 deadline)"
    );

    function _signPermit(uint256 key, address spender, uint256 value, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IERC20Permit(address(USDC)).DOMAIN_SEPARATOR(),
                keccak256(abi.encode(PERMIT_TYPEHASH, vm.addr(key), spender, value, nonce, deadline))
            )
        );
        return vm.sign(key, digest);
    }

    function _signAuthorization(uint256 key, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        Authorization memory authorization = Authorization(vm.addr(key), authorized, isAuthorized, nonce, deadline);
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", MORPHO.DOMAIN_SEPARATOR(), keccak256(abi.encode(AUTHORIZATION_TYPEHASH, authorization))
            )
        );
        return vm.sign(key, digest);
    }

    function _assertRouterEmpty() internal view {
        assertEq(USDC.balanceOf(address(router)), 0, "router holds USDC");
        assertEq(AQQQ.balanceOf(address(router)), 0, "router holds stock");
    }

    function _position(Id id) internal view returns (Position memory) {
        return MORPHO.position(id, user);
    }
}
