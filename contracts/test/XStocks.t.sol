// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";

/// Stands for our router or our liquidator: a contract that receives stock, approves Morpho and
/// supplies or withdraws collateral, the way the router does on every open and close.
contract StockHandler {
    function approve(IERC20 token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function send(IERC20 token, address to, uint256 amount) external {
        token.transfer(to, amount);
    }

    function pull(IERC20 token, address from, uint256 amount) external {
        token.transferFrom(from, address(this), amount);
    }

    function supplyAndWithdraw(IMorpho morpho, MarketParams memory params, uint256 amount) external {
        IERC20(params.collateralToken).approve(address(morpho), amount);
        morpho.supplyCollateral(params, amount, address(this), "");
        morpho.withdrawCollateral(params, amount, address(this), address(this));
    }
}

interface ISanctionsList {
    function owner() external view returns (address);
    function addToSanctionsList(address[] calldata accounts) external;
}

/// The four wrapped xStocks on X Layer (D-68) move through Morpho and through contracts that stand
/// for our router and liquidator (SC-81). Unlike the Coinbase stocks on Base, these are plain
/// contracts, so a fork runs them.
contract XStocksXLayerForkTest is Test {
    IMorpho internal constant MORPHO = IMorpho(0xeb00C490E888286357dC5B0a35D37D9260D11Ab5);
    /// Read from the underlying xStock's sanctionsList().
    ISanctionsList internal constant SANCTIONS = ISanctionsList(0x615Dd3B9445A94334C1579F68115042D77CC7c44);
    uint256 internal constant FORK_BLOCK = 76_327_204;

    function _markets() internal pure returns (Id[4] memory) {
        return [
            Id.wrap(0x0c19a193032b01e2ecee6a0a35e9be9a905a78c52f24a56c6a2f64bd2e0b5601), // wNVDAx
            Id.wrap(0x0c852bb690ec939c27ca6771de584d47e97b47a4a988526a739821fc529da9c2), // wQQQx
            Id.wrap(0xdfd1a7454eb7ae5dbbd4399f35e0207255ab479b3ceaf42cd6ec5cf2cbb8ddcc), // wSPYx
            Id.wrap(0xeb1d5993406983798777f691ad975422e9ada82f85cc13a1c3d6584416933b5d) // wGOOGLx
        ];
    }

    function setUp() public {
        vm.createSelectFork(vm.envOr("XLAYER_RPC_URL", string("https://rpc.xlayer.tech")), FORK_BLOCK);
    }

    function test_everyStockMovesThroughMorphoTheRouterAndTheLiquidator() public {
        Id[4] memory markets = _markets();
        StockHandler router = new StockHandler();
        StockHandler liquidator = new StockHandler();
        uint256 amount = 1e15;

        for (uint256 i; i < markets.length; ++i) {
            MarketParams memory params = MORPHO.idToMarketParams(markets[i]);
            IERC20 stock = IERC20(params.collateralToken);

            vm.prank(address(MORPHO));
            stock.transfer(address(router), amount);
            router.supplyAndWithdraw(MORPHO, params, amount);
            assertEq(stock.balanceOf(address(router)), amount, "router got its collateral back");

            router.approve(stock, address(liquidator), amount);
            liquidator.pull(stock, address(router), amount);
            liquidator.send(stock, address(router), amount);
            assertEq(stock.balanceOf(address(router)), amount, "liquidator pulled and returned");

            router.send(stock, address(MORPHO), amount);
            assertEq(stock.balanceOf(address(router)), 0);
        }
    }

    /// The issuer's sanctions list reaches the wrapped token: a listed router can no longer receive it.
    function test_aSanctionedRouterCannotReceiveTheWrappedStock() public {
        MarketParams memory params = MORPHO.idToMarketParams(_markets()[0]);
        IERC20 stock = IERC20(params.collateralToken);
        StockHandler router = new StockHandler();
        address[] memory listed = new address[](1);
        listed[0] = address(router);
        vm.prank(SANCTIONS.owner());
        SANCTIONS.addToSanctionsList(listed);

        vm.prank(address(MORPHO));
        vm.expectRevert();
        stock.transfer(address(router), 1e15);
    }
}
