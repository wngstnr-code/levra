// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {ChainlinkSessionOracle} from "../src/ChainlinkSessionOracle.sol";
import {IAnchoredStockOracle} from "../src/interfaces/IAnchoredStockOracle.sol";
import {IChainlinkFeed} from "../src/interfaces/IChainlinkFeed.sol";
import {ICoinbaseOracleRegistry} from "../src/interfaces/ICoinbaseOracleRegistry.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Side} from "../src/interfaces/Types.sol";
import {Lens} from "../src/Lens.sol";
import {Liquidator} from "../src/Liquidator.sol";
import {MarginRouter} from "../src/MarginRouter.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {SessionOracle} from "../src/SessionOracle.sol";

/// Deploys the Levra contracts on one chain and creates its stock markets on Morpho, from
/// config/<chain>.json (DEPLOY_CONFIG). Limits come from docs/04-risk-rules.md and are initial proposals.
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    struct ChainConfig {
        IMorpho morpho;
        address irm;
        address usdc;
        uint8 usdcDecimals;
        address[] swapTargets;
        /// Zero means the target itself (D-88).
        address[] swapSpenders;
        bool chainlink;
        IAnchoredStockOracle anchoredOracle;
        ICoinbaseOracleRegistry coinbaseRegistry;
        uint256 priceBoundFactor;
        uint256 feeBps;
        uint256 keeperFeeBps;
        uint32 preCloseWindow;
        uint32 minOracleAge;
        uint64 maxPublishAge;
    }

    struct Plan {
        string symbol;
        address stock;
        uint8 stockDecimals;
        Side side;
        uint256 lltv;
        uint64 softOpen;
        uint64 softClosed;
        uint32 maxDeviationBps;
        uint128 maxPositionUsd;
        /// Hard age of the price while the market is open. Fixed forever at deployment.
        uint64 maxFeedAge;
        /// Soft age for opening a position. The oracle age poster moves it up to maxFeedAge.
        uint32 maxOracleAge;
        /// Chainlink feed, or zero for the Anchored oracle.
        address feed;
    }

    struct Deployed {
        RiskManager risk;
        MarginRouter router;
        Lens lens;
        Liquidator liquidator;
        Id[] marketIds;
        address[] oracles;
    }

    function run() external {
        string memory json = vm.readFile(vm.envOr("DEPLOY_CONFIG", string("config/monad.json")));
        address deployer = msg.sender;
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        vm.startBroadcast();
        Deployed memory d = deploy(json, deployer, feeRecipient);
        _setRolesAndOwner(d, deployer);
        vm.stopBroadcast();
        // A dry run (no --broadcast) must never overwrite a deployment file with simulated addresses.
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            vm.writeFile(
                string.concat("deployments/", vm.envOr("DEPLOY_ENV", string("fork")), ".json"), deploymentJson(json, d)
            );
        }
    }

    /// Everything that does not depend on environment variables, so a test can run it as is.
    function deploy(string memory json, address owner, address feeRecipient) public returns (Deployed memory d) {
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "config is for another chain");
        ChainConfig memory c = _chain(json);
        d.risk = new RiskManager(c.morpho, owner, c.preCloseWindow);
        d.router = new MarginRouter(c.morpho, d.risk, c.swapTargets, c.swapSpenders, owner, feeRecipient, c.feeBps);
        d.lens = new Lens(c.morpho, d.risk, d.router);
        d.liquidator = new Liquidator(c.morpho, c.swapTargets, c.swapSpenders, owner, feeRecipient);
        d.router.setFees(c.feeBps, c.keeperFeeBps, feeRecipient);

        uint256 n = _count(json, ".markets");
        d.marketIds = new Id[](n);
        d.oracles = new address[](n);
        for (uint256 i; i < n; ++i) {
            Plan memory plan = _plan(json, i);
            (d.marketIds[i], d.oracles[i]) = _addMarket(c, d.risk, plan);
        }
    }

    function _setRolesAndOwner(Deployed memory d, address deployer) internal {
        address keeper = vm.envOr("KEEPER", address(0));
        address liquidatorKeeper = vm.envOr("LIQUIDATOR_KEEPER", keeper);
        if (keeper != address(0)) d.router.setKeeper(keeper, true);
        if (liquidatorKeeper != address(0)) d.liquidator.setKeeper(liquidatorKeeper, true);
        address calendarPoster = vm.envOr("CALENDAR_POSTER", address(0));
        if (calendarPoster != address(0)) d.risk.setCalendarPoster(calendarPoster);
        address agePoster = vm.envOr("ORACLE_AGE_POSTER", address(0));
        if (agePoster != address(0)) d.risk.setOracleAgePoster(agePoster);
        address owner = vm.envOr("OWNER", deployer);
        if (owner != deployer) {
            d.risk.transferOwnership(owner);
            d.router.transferOwnership(owner);
            d.liquidator.transferOwnership(owner);
        }
    }

    function _addMarket(ChainConfig memory c, RiskManager risk, Plan memory plan)
        internal
        returns (Id id, address oracle)
    {
        oracle = c.chainlink ? _chainlinkOracle(c, plan) : _anchoredOracle(c, plan);
        MarketParams memory mp = plan.side == Side.Long
            ? MarketParams(c.usdc, plan.stock, oracle, c.irm, plan.lltv)
            : MarketParams(plan.stock, c.usdc, oracle, c.irm, plan.lltv);
        c.morpho.createMarket(mp);
        id = mp.id();
        risk.setMarketConfig(
            id,
            IRiskManager.MarketConfig({
                enabled: true,
                side: plan.side,
                oracle: oracle,
                softLtvOpen: plan.softOpen,
                softLtvClosed: plan.softClosed,
                maxDeviationBps: plan.maxDeviationBps,
                maxOracleAge: plan.maxOracleAge,
                maxPositionUsd: plan.maxPositionUsd
            })
        );
        risk.setOracleAgeBounds(id, c.minOracleAge, uint32(plan.maxFeedAge));
    }

    function _anchoredOracle(ChainConfig memory c, Plan memory plan) internal returns (address) {
        return address(
            new SessionOracle(
                c.anchoredOracle,
                keccak256(bytes(plan.symbol)),
                plan.side,
                plan.stockDecimals,
                c.usdcDecimals,
                plan.maxFeedAge,
                c.maxPublishAge
            )
        );
    }

    /// Price bounds are a factor around the feed price at deployment (04, Base limits).
    function _chainlinkOracle(ChainConfig memory c, Plan memory plan) internal returns (address) {
        (, int256 answer,,,) = IChainlinkFeed(plan.feed).latestRoundData();
        require(answer > 0, "feed has no price");
        uint256 p = uint256(answer);
        return address(
            new ChainlinkSessionOracle(
                IChainlinkFeed(plan.feed),
                c.coinbaseRegistry,
                plan.stock,
                plan.side,
                plan.stockDecimals,
                c.usdcDecimals,
                plan.maxFeedAge,
                c.maxPublishAge,
                p / c.priceBoundFactor,
                p * c.priceBoundFactor
            )
        );
    }

    function _chain(string memory json) internal view returns (ChainConfig memory c) {
        c.morpho = IMorpho(vm.parseJsonAddress(json, ".morpho"));
        c.irm = vm.parseJsonAddress(json, ".irm");
        c.usdc = vm.parseJsonAddress(json, ".usdc");
        c.usdcDecimals = uint8(vm.parseJsonUint(json, ".usdcDecimals"));
        c.swapTargets = vm.parseJsonAddressArray(json, ".swapTargets");
        c.swapSpenders = vm.keyExistsJson(json, ".swapSpenders")
            ? vm.parseJsonAddressArray(json, ".swapSpenders")
            : new address[](c.swapTargets.length);
        bytes32 kind = keccak256(bytes(vm.parseJsonString(json, ".oracleKind")));
        require(kind == keccak256("anchored") || kind == keccak256("chainlink"), "unknown oracle kind");
        c.chainlink = kind == keccak256("chainlink");
        c.anchoredOracle = IAnchoredStockOracle(vm.parseJsonAddress(json, ".anchoredOracle"));
        c.coinbaseRegistry = ICoinbaseOracleRegistry(vm.parseJsonAddress(json, ".coinbaseRegistry"));
        c.priceBoundFactor = vm.parseJsonUint(json, ".priceBoundFactor");
        require(!c.chainlink || c.priceBoundFactor > 1, "chainlink markets need price bounds");
        c.feeBps = vm.parseJsonUint(json, ".feeBps");
        c.keeperFeeBps = vm.parseJsonUint(json, ".keeperFeeBps");
        c.preCloseWindow = uint32(vm.parseJsonUint(json, ".preCloseWindow"));
        c.minOracleAge = uint32(vm.parseJsonUint(json, ".minOracleAge"));
        c.maxPublishAge = uint64(vm.parseJsonUint(json, ".maxPublishAge"));
    }

    function _plan(string memory json, uint256 i) internal view returns (Plan memory p) {
        string memory at = string.concat(".markets[", vm.toString(i), "]");
        p.symbol = vm.parseJsonString(json, string.concat(at, ".symbol"));
        p.stock = vm.parseJsonAddress(json, string.concat(at, ".stock"));
        p.stockDecimals = uint8(vm.parseJsonUint(json, string.concat(at, ".stockDecimals")));
        bytes32 side = keccak256(bytes(vm.parseJsonString(json, string.concat(at, ".side"))));
        require(side == keccak256("long") || side == keccak256("short"), "unknown side");
        p.side = side == keccak256("long") ? Side.Long : Side.Short;
        p.lltv = vm.parseJsonUint(json, string.concat(at, ".lltv"));
        p.softOpen = uint64(vm.parseJsonUint(json, string.concat(at, ".softLtvOpen")));
        p.softClosed = uint64(vm.parseJsonUint(json, string.concat(at, ".softLtvClosed")));
        p.maxDeviationBps = uint32(vm.parseJsonUint(json, string.concat(at, ".maxDeviationBps")));
        p.maxPositionUsd = uint128(vm.parseJsonUint(json, string.concat(at, ".maxPositionUsd")));
        p.maxFeedAge = uint64(vm.parseJsonUint(json, string.concat(at, ".maxFeedAge")));
        p.maxOracleAge = uint32(vm.parseJsonUint(json, string.concat(at, ".maxOracleAge")));
        if (vm.keyExistsJson(json, string.concat(at, ".feed"))) {
            p.feed = vm.parseJsonAddress(json, string.concat(at, ".feed"));
        }
    }

    function _count(string memory json, string memory key) internal view returns (uint256 n) {
        while (vm.keyExistsJson(json, string.concat(key, "[", vm.toString(n), "]"))) ++n;
    }

    function deploymentJson(string memory json, Deployed memory d) public view returns (string memory out) {
        string memory markets;
        for (uint256 i; i < d.marketIds.length; ++i) {
            Plan memory plan = _plan(json, i);
            ISessionOracle oracle = ISessionOracle(d.oracles[i]);
            bool long = plan.side == Side.Long;
            markets = string.concat(
                markets,
                i == 0 ? "" : ",",
                '{"symbol":"',
                plan.symbol,
                '","side":"',
                long ? "long" : "short",
                '","marketId":"',
                vm.toString(Id.unwrap(d.marketIds[i])),
                '","oracle":"',
                vm.toString(address(oracle)),
                '","collateralToken":"',
                vm.toString(long ? plan.stock : vm.parseJsonAddress(json, ".usdc")),
                '","loanToken":"',
                vm.toString(long ? vm.parseJsonAddress(json, ".usdc") : plan.stock),
                '","lltv":"',
                vm.toString(plan.lltv),
                '"}'
            );
        }
        out = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"block":',
            vm.toString(block.number),
            ',"router":"',
            vm.toString(address(d.router)),
            '","riskManager":"',
            vm.toString(address(d.risk)),
            '","lens":"',
            vm.toString(address(d.lens)),
            '","liquidator":"',
            vm.toString(address(d.liquidator)),
            '","markets":[',
            markets,
            "]}"
        );
    }
}
