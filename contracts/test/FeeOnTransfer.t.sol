// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Id, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/src/libraries/MarketParamsLib.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {Side, Swap} from "../src/interfaces/Types.sol";
import {BaseTest, TestSwapper} from "./Base.t.sol";

/// A stock token after an issuer upgrade that burns 1% of every transfer between two holders.
contract FeeStock is ERC20 {
    uint256 internal constant FEE_BPS = 100;

    constructor() ERC20("Fee Stock", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, value);
        uint256 fee = value * FEE_BPS / 10_000;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}

/// T-17: the router credits what it really received from a swap, never the amount the route promised.
/// Morpho Blue does not support such tokens: it credits the amount it asked for, not what arrived.
contract FeeOnTransferTest is BaseTest {
    using MarketParamsLib for MarketParams;

    FeeStock internal feeStock;
    MarketParams internal feeMarket;
    Id internal feeId;

    function setUp() public override {
        super.setUp();
        feeStock = new FeeStock();
        feeMarket = MarketParams(address(USDC), address(feeStock), address(longOracle), IRM, LLTV);
        MORPHO.createMarket(feeMarket);
        feeId = feeMarket.id();
        risk.setMarketConfig(feeId, _config(Side.Long, address(longOracle)));
        feeStock.mint(address(swapper), 1_000e18);
        deal(address(USDC), lender, 50_000e6);
        vm.prank(lender);
        MORPHO.supply(feeMarket, 50_000e6, 0, lender, "");
    }

    function _params(uint256 promised, uint256 minOut) internal view returns (IMarginRouter.OpenParams memory p) {
        uint256 swapIn = 2_000e6 - 2_000e6 * router.feeBps() / 10_000;
        p = IMarginRouter.OpenParams({
            marketId: feeId,
            margin: 1_000e6,
            borrowAssets: 1_000e6,
            swap: Swap(
                address(swapper),
                abi.encodeCall(TestSwapper.swap, (USDC, IERC20(address(feeStock)), swapIn, promised)),
                minOut
            ),
            maxLtv: SOFT_OPEN,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function _promised() internal view returns (uint256) {
        return _stockFor(2_000e6 - 2_000e6 * router.feeBps() / 10_000, 0);
    }

    function test_swapOutputIsMeasuredNotPromised() public {
        uint256 promised = _promised();
        uint256 received = promised - promised / 100;
        IMarginRouter.OpenParams memory p = _params(promised, promised);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IMarginRouter.InsufficientSwapOutput.selector, received, promised));
        router.openLong(p);
    }

    function test_collateralIsWhatArrivedAndRouterEndsEmpty() public {
        uint256 promised = _promised();
        uint256 received = promised - promised / 100;
        uint256 morphoBefore = feeStock.balanceOf(address(MORPHO));

        IMarginRouter.OpenParams memory p = _params(promised, received);
        vm.prank(user);
        (uint256 collateral,) = router.openLong(p);

        assertEq(collateral, received, "credited the promised amount");
        assertEq(_position(feeId).collateral, received, "position collateral");
        assertEq(feeStock.balanceOf(address(router)), 0, "router holds the stock");
        assertEq(USDC.balanceOf(address(router)), 0, "router holds USDC");
        // Why the market breaks: Morpho books `received` but gets 1% less, so it holds less than it owes.
        assertLt(feeStock.balanceOf(address(MORPHO)) - morphoBefore, received, "morpho got the full amount");
    }
}
