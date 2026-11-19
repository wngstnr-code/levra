// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Id, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {ChainlinkSessionOracle} from "../src/ChainlinkSessionOracle.sol";
import {IRiskManager} from "../src/interfaces/IRiskManager.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Side} from "../src/interfaces/Types.sol";
import {IMetaMorpho, IMetaMorphoFactory} from "../src/interfaces/IMetaMorpho.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DeployVault} from "../script/DeployVault.s.sol";
import {VaultPlan} from "../script/VaultPlan.sol";

/// What the old Monad-only script deployed, market by market. The config driven script must match it.
struct Expected {
    string symbol;
    Side side;
    uint256 lltv;
    uint64 softOpen;
    uint64 softClosed;
    uint32 maxDeviationBps;
    uint128 maxPositionUsd;
    uint64 maxFeedAge;
    uint32 maxOracleAge;
}

abstract contract DeployScriptTest is Test {
    Deploy internal script;
    Deploy.Deployed internal d;
    string internal json;

    function _run(string memory configPath) internal {
        json = vm.readFile(configPath);
        script = new Deploy();
        d = script.deploy(json, address(script), address(0xFEE));
    }

    function _check(uint256 i, Expected memory e) internal view {
        Id id = d.marketIds[i];
        IRiskManager.MarketConfig memory c = d.risk.config(id);
        assertTrue(c.enabled, e.symbol);
        assertEq(uint8(c.side), uint8(e.side), e.symbol);
        assertEq(c.softLtvOpen, e.softOpen, e.symbol);
        assertEq(c.softLtvClosed, e.softClosed, e.symbol);
        assertEq(c.maxDeviationBps, e.maxDeviationBps, e.symbol);
        assertEq(c.maxPositionUsd, e.maxPositionUsd, e.symbol);
        assertEq(c.maxOracleAge, e.maxOracleAge, e.symbol);
        assertEq(c.oracle, d.oracles[i], e.symbol);
        ISessionOracle oracle = ISessionOracle(d.oracles[i]);
        assertEq(uint8(oracle.side()), uint8(e.side), e.symbol);
        assertEq(oracle.MAX_FEED_AGE(), e.maxFeedAge, e.symbol);
        assertEq(oracle.MAX_PUBLISH_AGE(), 4 days, e.symbol);
        (, uint32 cap) = d.risk.oracleAgeBounds(id);
        assertEq(cap, uint32(e.maxFeedAge), e.symbol);
        MarketParams memory mp = d.risk.MORPHO().idToMarketParams(id);
        assertEq(mp.lltv, e.lltv, e.symbol);
        assertEq(mp.oracle, d.oracles[i], e.symbol);
    }
}

/// The Monad config reproduces the deployment that is live on Monad mainnet.
contract DeployMonadTest is DeployScriptTest {
    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC_URL", string("https://rpc.monad.xyz")), 112_980_350);
        _run("config/monad.json");
    }

    function test_matchesTheLiveMonadPlan() public view {
        Expected[5] memory plan = [
            Expected("QQQ", Side.Long, 0.77e18, 0.73e18, 0.7e18, 500, 500e6, 1 hours, 35 minutes),
            Expected("HOOD", Side.Long, 0.625e18, 0.58e18, 0.5e18, 1_000, 1_000e6, 1 hours, 36 minutes),
            Expected("BIL", Side.Long, 0.915e18, 0.9e18, 0.9e18, 100, 1_000e6, 3 hours, 51 minutes),
            Expected("QQQ", Side.Short, 0.77e18, 0.73e18, 0.7e18, 500, 500e6, 1 hours, 35 minutes),
            Expected("HOOD", Side.Short, 0.625e18, 0.58e18, 0.5e18, 1_000, 1_000e6, 1 hours, 36 minutes)
        ];
        assertEq(d.marketIds.length, plan.length);
        for (uint256 i; i < plan.length; ++i) {
            _check(i, plan[i]);
            assertEq(ISessionOracle(d.oracles[i]).priceId(), keccak256(bytes(plan[i].symbol)));
            (uint32 min,) = d.risk.oracleAgeBounds(d.marketIds[i]);
            assertEq(min, 1_500);
        }
        address[] memory targets = d.router.swapTargets();
        assertEq(targets.length, 1);
        assertEq(targets[0], 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5);
        assertEq(d.router.feeBps(), 10);
        assertEq(d.router.keeperFeeBps(), 30);
        assertEq(d.risk.preCloseWindow(), 4 hours);
    }

    function test_refusesAConfigForAnotherChain() public {
        string memory base = vm.readFile("config/base.json");
        Deploy other = new Deploy();
        vm.expectRevert("config is for another chain");
        other.deploy(base, address(other), address(0xFEE));
    }
}

/// The vault caps of the Monad config match the caps of the live vault, read against the live deployment file.
contract DeployVaultMonadTest is Test {
    function test_capsMatchTheLiveVaultPlan() public {
        DeployVault script = new DeployVault();
        (Id[] memory ids, uint256[] memory caps) =
            script.longMarketsAndCaps(vm.readFile("config/monad.json"), vm.readFile("deployments/monad.json"));
        assertEq(ids.length, 3);
        assertEq(caps[0], 10_000e6, "QQQ");
        assertEq(caps[1], 5_000e6, "HOOD");
        assertEq(caps[2], 20_000e6, "BIL");
    }
}

/// A rehearsal of the Base deployment on a fork (SC-76). Market creation, configuration and the
/// oracles run for real; moving the stock tokens does not, since they are precompiles a fork cannot run.
contract DeployBaseForkTest is DeployScriptTest {
    /// Thursday 19 November 2026, 13:20:35 UTC.
    uint256 internal constant WEEKDAY_BLOCK = 59_520_298;
    address internal constant NVDA_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address internal constant REGISTRY = 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")), WEEKDAY_BLOCK);
        _run("config/base.json");
    }

    function test_createsALongAndAShortMarketForEveryStock() public view {
        Expected[8] memory long = [
            Expected("AAPL", Side.Long, 0.77e18, 0.7e18, 0.66e18, 200, 5_000e6, 36 hours, 26 hours),
            Expected("AMZN", Side.Long, 0.77e18, 0.72e18, 0.68e18, 200, 5_000e6, 36 hours, 26 hours),
            Expected("GOOGL", Side.Long, 0.77e18, 0.73e18, 0.7e18, 200, 5_000e6, 36 hours, 26 hours),
            Expected("META", Side.Long, 0.77e18, 0.72e18, 0.68e18, 200, 5_000e6, 36 hours, 26 hours),
            Expected("MSFT", Side.Long, 0.77e18, 0.73e18, 0.7e18, 200, 5_000e6, 36 hours, 26 hours),
            Expected("NVDA", Side.Long, 0.625e18, 0.58e18, 0.5e18, 200, 2_500e6, 36 hours, 26 hours),
            Expected("SPCX", Side.Long, 0.625e18, 0.55e18, 0.45e18, 300, 1_000e6, 36 hours, 26 hours),
            Expected("TSLA", Side.Long, 0.625e18, 0.58e18, 0.52e18, 300, 2_500e6, 36 hours, 26 hours)
        ];
        assertEq(d.marketIds.length, 16);
        for (uint256 i; i < 8; ++i) {
            _check(i, long[i]);
            Expected memory short = long[i];
            short.side = Side.Short;
            _check(i + 8, short);
            (uint32 min,) = d.risk.oracleAgeBounds(d.marketIds[i]);
            assertEq(min, 2 hours);
        }
        address[] memory targets = d.router.swapTargets();
        assertEq(targets.length, 3);
        assertEq(d.liquidator.swapTargets().length, 3);
    }

    function test_createsTheUsdcVaultOverTheLongMarkets() public {
        DeployVault vaultScript = new DeployVault();
        (Id[] memory ids, uint256[] memory caps) = vaultScript.longMarketsAndCaps(json, script.deploymentJson(json, d));
        assertEq(ids.length, 8);
        IMetaMorpho vault = this.createVault(ids, caps);
        assertEq(vault.asset(), vm.parseJsonAddress(json, ".usdc"));
        assertEq(vault.supplyQueueLength(), 8);
        (uint184 nvdaCap, bool enabled,) = vault.config(d.marketIds[5]);
        assertEq(nvdaCap, 5_000e6);
        assertTrue(enabled);
        (uint184 msftCap,,) = vault.config(d.marketIds[4]);
        assertEq(msftCap, 10_000e6);
    }

    function createVault(Id[] memory ids, uint256[] memory caps) external returns (IMetaMorpho) {
        return VaultPlan.create(
            IMetaMorphoFactory(vm.parseJsonAddress(json, ".vaultFactory")),
            d.risk.MORPHO(),
            vm.parseJsonAddress(json, ".usdc"),
            ids,
            caps,
            address(0xFEE),
            bytes32(uint256(3))
        );
    }

    function test_oraclesReadTheCoinbaseFeedsWithBoundsAroundTheDeploymentPrice() public {
        // The registry reads the stock token, a precompile, so answer it as the live node did.
        vm.mockCall(
            REGISTRY, abi.encodeWithSelector(bytes4(keccak256("getOracleParams(address)"))), abi.encode(1e18, false)
        );
        ChainlinkSessionOracle nvdaLong = ChainlinkSessionOracle(d.oracles[5]);
        ChainlinkSessionOracle nvdaShort = ChainlinkSessionOracle(d.oracles[13]);
        assertEq(address(nvdaLong.FEED()), NVDA_FEED);
        assertEq(address(nvdaLong.REGISTRY()), REGISTRY);
        assertEq(nvdaLong.MIN_PRICE_E8(), uint256(15_362_194_489) / 10);
        assertEq(nvdaLong.MAX_PRICE_E8(), uint256(15_362_194_489) * 10);
        assertEq(nvdaLong.price(), uint256(15_362_194_489) * 1e26);
        assertEq(nvdaShort.price(), uint256(1e46) / 15_362_194_489);
        (,,,,,, bool stale) = nvdaLong.snapshot();
        assertFalse(stale);
    }
}

/// A rehearsal of the X Layer deployment on a fork (SC-82, SC-83). Unlike Base, the wrapped xStocks
/// are plain contracts, so a fork runs everything.
contract DeployXLayerForkTest is DeployScriptTest {
    /// 20 November 2026.
    uint256 internal constant FORK_BLOCK = 76_345_308;
    address internal constant OKX_ROUTER = 0x7c5bEE2a8091C3ef39072f64F18Fac913060AEaF;
    address internal constant OKX_APPROVE = 0x8b773D83bc66Be128c60e07E17C8901f7a64F000;
    address internal constant UNISWAP_ROUTER = 0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA;
    /// Morpho's own oracle for the listed wNVDAx market, priced by the same feed.
    address internal constant MORPHO_WNVDAX_ORACLE = 0x787f5aCC336AFB68f72F125a5E20B0f0849E27dd;

    function setUp() public {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")), FORK_BLOCK);
        _run("config/xlayer.json");
    }

    function test_createsALongAndAShortMarketForEveryStock() public view {
        Expected[4] memory long = [
            Expected("GOOGL", Side.Long, 0.77e18, 0.73e18, 0.7e18, 200, 5_000e6, 36 hours, 30 minutes),
            Expected("NVDA", Side.Long, 0.625e18, 0.58e18, 0.5e18, 200, 2_500e6, 36 hours, 30 minutes),
            Expected("QQQ", Side.Long, 0.77e18, 0.73e18, 0.7e18, 150, 5_000e6, 36 hours, 30 minutes),
            Expected("SPY", Side.Long, 0.77e18, 0.73e18, 0.7e18, 150, 5_000e6, 36 hours, 30 minutes)
        ];
        assertEq(d.marketIds.length, 8);
        for (uint256 i; i < 4; ++i) {
            _check(i, long[i]);
            Expected memory short = long[i];
            short.side = Side.Short;
            _check(i + 4, short);
            (uint32 min,) = d.risk.oracleAgeBounds(d.marketIds[i]);
            assertEq(min, 10 minutes);
        }
    }

    function test_swapTargetsAndTheOkxApproveContract() public view {
        address[] memory targets = d.router.swapTargets();
        assertEq(targets.length, 2);
        assertEq(d.router.swapSpender(OKX_ROUTER), OKX_APPROVE);
        assertEq(d.router.swapSpender(UNISWAP_ROUTER), UNISWAP_ROUTER);
        assertEq(d.liquidator.swapSpender(OKX_ROUTER), OKX_APPROVE);
    }

    function test_oracleMatchesMorphoOwnOracleAndHasNoRegistry() public view {
        ChainlinkSessionOracle nvdaLong = ChainlinkSessionOracle(d.oracles[1]);
        assertEq(address(nvdaLong.REGISTRY()), address(0));
        assertEq(nvdaLong.price(), ISessionOracle(MORPHO_WNVDAX_ORACLE).price());
        (,,,,,, bool stale) = nvdaLong.snapshot();
        assertFalse(stale);
    }
}
