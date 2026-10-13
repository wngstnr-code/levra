// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {IAnchoredStockOracle} from "../src/interfaces/IAnchoredStockOracle.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {Side} from "../src/interfaces/Types.sol";
import {Lens} from "../src/Lens.sol";
import {Liquidator} from "../src/Liquidator.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {SessionOracle} from "../src/SessionOracle.sol";

/// Deploys the Levra contracts on Monad and creates the stock markets on Morpho.
/// Limits come from docs/04-risk-rules.md and are initial proposals.
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    IMorpho internal constant MORPHO = IMorpho(0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee);
    address internal constant IRM = 0x09475a3D6eA8c314c592b1a3799bDE044E2F400F;
    address internal constant KYBER_ROUTER = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;
    IAnchoredStockOracle internal constant STOCK_ORACLE =
        IAnchoredStockOracle(0x037848af338C38e1e0AB722bE80BF4C2E612a1F7);
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address internal constant AQQQ = 0x1446501E886c7f830DB9b494A1890cBCCC072f57;
    address internal constant AHOOD = 0x5a4860adDCc094FcE026384caeEcb1e634DD9af4;
    address internal constant ABIL = 0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f;

    /// Hard age of the oracle price while the market is closed. The longest close is a holiday weekend, about 72 hours.
    uint64 internal constant MAX_PUBLISH_AGE = 4 days;
    /// Lowest max age the oracle age poster may set (D-31). Anchored suggests no less than this.
    uint32 internal constant MIN_ORACLE_AGE = 1_500;
    uint32 internal constant PRE_CLOSE_WINDOW = 4 hours;
    uint256 internal constant FEE_BPS = 10;
    uint256 internal constant KEEPER_FEE_BPS = 30;

    struct Plan {
        string symbol;
        address stock;
        Side side;
        uint256 lltv;
        uint64 softOpen;
        uint64 softClosed;
        uint32 maxDeviationBps;
        uint128 maxPositionUsd;
        /// Hard age of the source quote while the market is open. Fixed forever at deployment.
        uint64 maxFeedAge;
        /// Soft age for opening a position. The oracle age poster moves it up to maxFeedAge.
        uint32 maxOracleAge;
    }

    RiskManager internal risk;
    string internal marketsJson;

    function run() external {
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address keeper = vm.envOr("KEEPER", address(0));
        string memory environment = vm.envOr("DEPLOY_ENV", string("fork"));

        vm.startBroadcast();
        risk = new RiskManager(MORPHO, deployer, PRE_CLOSE_WINDOW);
        MarginRouter router = new MarginRouter(MORPHO, risk, KYBER_ROUTER, deployer, feeRecipient, FEE_BPS);
        Lens lens = new Lens(MORPHO, risk, router);
        Liquidator liquidator = new Liquidator(MORPHO, KYBER_ROUTER, deployer, feeRecipient);
        router.setFees(FEE_BPS, KEEPER_FEE_BPS, feeRecipient);
        if (keeper != address(0)) {
            router.setKeeper(keeper, true);
            liquidator.setKeeper(keeper, true);
        }

        // Ages come from two weeks of oracle data (docs/reports/oracle-2026-10-13.md). The source quote
        // was at most 27 minutes old for QQQ, 34 for HOOD and 82 for BIL, whose feed is slow after hours.
        Plan[5] memory plans = [
            Plan("QQQ", AQQQ, Side.Long, 0.77e18, 0.73e18, 0.7e18, 500, 500e6, 1 hours, 35 minutes),
            Plan("HOOD", AHOOD, Side.Long, 0.625e18, 0.58e18, 0.5e18, 1_000, 1_000e6, 1 hours, 36 minutes),
            Plan("BIL", ABIL, Side.Long, 0.915e18, 0.9e18, 0.9e18, 100, 1_000e6, 3 hours, 51 minutes),
            Plan("QQQ", AQQQ, Side.Short, 0.77e18, 0.73e18, 0.7e18, 500, 500e6, 1 hours, 35 minutes),
            Plan("HOOD", AHOOD, Side.Short, 0.625e18, 0.58e18, 0.5e18, 1_000, 1_000e6, 1 hours, 36 minutes)
        ];
        for (uint256 i; i < plans.length; ++i) {
            _addMarket(plans[i], i == plans.length - 1);
        }

        address calendarPoster = vm.envOr("CALENDAR_POSTER", address(0));
        if (calendarPoster != address(0)) risk.setCalendarPoster(calendarPoster);
        address agePoster = vm.envOr("ORACLE_AGE_POSTER", address(0));
        if (agePoster != address(0)) risk.setOracleAgePoster(agePoster);

        if (owner != deployer) {
            risk.transferOwnership(owner);
            router.transferOwnership(owner);
            liquidator.transferOwnership(owner);
        }
        vm.stopBroadcast();

        string memory json = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"block":',
            vm.toString(block.number),
            ',"router":"',
            vm.toString(address(router)),
            '","riskManager":"',
            vm.toString(address(risk)),
            '","lens":"',
            vm.toString(address(lens)),
            '","liquidator":"',
            vm.toString(address(liquidator)),
            '","markets":[',
            marketsJson,
            "]}"
        );
        vm.writeFile(string.concat("deployments/", environment, ".json"), json);
    }

    function _addMarket(Plan memory plan, bool last) internal {
        uint8 stockDecimals = IERC20Metadata(plan.stock).decimals();
        uint8 quoteDecimals = IERC20Metadata(USDC).decimals();
        SessionOracle oracle = new SessionOracle(
            STOCK_ORACLE,
            keccak256(bytes(plan.symbol)),
            plan.side,
            stockDecimals,
            quoteDecimals,
            plan.maxFeedAge,
            MAX_PUBLISH_AGE
        );
        MarketParams memory mp = plan.side == Side.Long
            ? MarketParams(USDC, plan.stock, address(oracle), IRM, plan.lltv)
            : MarketParams(plan.stock, USDC, address(oracle), IRM, plan.lltv);
        MORPHO.createMarket(mp);
        Id id = mp.id();
        risk.setMarketConfig(
            id,
            IRiskManager.MarketConfig({
                enabled: true,
                side: plan.side,
                oracle: address(oracle),
                softLtvOpen: plan.softOpen,
                softLtvClosed: plan.softClosed,
                maxDeviationBps: plan.maxDeviationBps,
                maxOracleAge: plan.maxOracleAge,
                maxPositionUsd: plan.maxPositionUsd
            })
        );
        risk.setOracleAgeBounds(id, MIN_ORACLE_AGE, uint32(plan.maxFeedAge));
        marketsJson = string.concat(
            marketsJson,
            '{"symbol":"',
            plan.symbol,
            '","side":"',
            plan.side == Side.Long ? "long" : "short",
            '","marketId":"',
            vm.toString(Id.unwrap(id)),
            '","oracle":"',
            vm.toString(address(oracle)),
            '","collateralToken":"',
            vm.toString(mp.collateralToken),
            '","loanToken":"',
            vm.toString(mp.loanToken),
            '","lltv":"',
            vm.toString(plan.lltv),
            last ? '"}' : '"},'
        );
    }
}
