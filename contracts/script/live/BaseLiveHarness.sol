// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {ChainlinkSessionOracle} from "../../src/ChainlinkSessionOracle.sol";
import {IChainlinkFeed} from "../../src/interfaces/IChainlinkFeed.sol";
import {ICoinbaseOracleRegistry} from "../../src/interfaces/ICoinbaseOracleRegistry.sol";
import {IRiskManager} from "../../src/interfaces/IRiskManager.sol";
import {Side} from "../../src/interfaces/Types.sol";
import {MarginRouter} from "../../src/MarginRouter.sol";
import {RiskManager} from "../../src/RiskManager.sol";

/// Only for `script/base-live-e2e.mjs` (SC-75): deployed inside an eth_simulateV1 run on the live Base
/// node, never on chain. Sets up one NVDAc long market and one NVDAc short market with the limits
/// of config/base.json, owned by this contract, so a full long and short can run against real
/// Coinbase stock tokens, which a fork cannot run. The order of `new` below fixes the addresses
/// the script predicts: risk = nonce 1, router = 2, long oracle = 3, short oracle = 4.
contract BaseLiveHarness {
    using MarketParamsLib for MarketParams;

    IMorpho public constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    address public constant IRM = 0x46415998764C29aB2a25CbeA6254146D50D22687;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address public constant NVDA_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address public constant REGISTRY = 0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD;
    uint256 public constant LLTV = 0.625e18;

    RiskManager public immutable risk;
    MarginRouter public immutable router;
    ChainlinkSessionOracle public immutable longOracle;
    ChainlinkSessionOracle public immutable shortOracle;
    Id public immutable longId;
    Id public immutable shortId;

    constructor(address[] memory swapTargets) {
        risk = new RiskManager(MORPHO, address(this), 4 hours);
        router = new MarginRouter(MORPHO, risk, swapTargets, address(this), address(this), 10);
        (, int256 answer,,,) = IChainlinkFeed(NVDA_FEED).latestRoundData();
        uint256 p = uint256(answer);
        longOracle = _oracle(Side.Long, p);
        shortOracle = _oracle(Side.Short, p);
        longId = _market(MarketParams(USDC, NVDAC, address(longOracle), IRM, LLTV), Side.Long, address(longOracle));
        shortId = _market(MarketParams(NVDAC, USDC, address(shortOracle), IRM, LLTV), Side.Short, address(shortOracle));
        router.setFees(10, 30, address(this));
    }

    /// Supplies what this contract holds: USDC to the long market and stock to the short market.
    function lend() external {
        uint256 usdc = IERC20(USDC).balanceOf(address(this));
        uint256 stock = IERC20(NVDAC).balanceOf(address(this));
        IERC20(USDC).approve(address(MORPHO), usdc);
        IERC20(NVDAC).approve(address(MORPHO), stock);
        MORPHO.supply(MORPHO.idToMarketParams(longId), usdc, 0, address(this), "");
        MORPHO.supply(MORPHO.idToMarketParams(shortId), stock, 0, address(this), "");
    }

    function _oracle(Side side, uint256 p) private returns (ChainlinkSessionOracle) {
        return new ChainlinkSessionOracle(
            IChainlinkFeed(NVDA_FEED),
            ICoinbaseOracleRegistry(REGISTRY),
            NVDAC,
            side,
            8,
            6,
            36 hours,
            4 days,
            p / 10,
            p * 10
        );
    }

    function _market(MarketParams memory mp, Side side, address oracle) private returns (Id id) {
        MORPHO.createMarket(mp);
        id = mp.id();
        risk.setMarketConfig(
            id,
            IRiskManager.MarketConfig({
                enabled: true,
                side: side,
                oracle: oracle,
                softLtvOpen: 0.58e18,
                softLtvClosed: 0.5e18,
                maxDeviationBps: 200,
                maxOracleAge: 26 hours,
                maxPositionUsd: 2_500e6
            })
        );
        risk.setOracleAgeBounds(id, 2 hours, 36 hours);
    }
}
