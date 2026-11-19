// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMarginRouter} from "../src/interfaces/IMarginRouter.sol";
import {ISessionOracle} from "../src/interfaces/ISessionOracle.sol";
import {Session} from "../src/interfaces/Types.sol";
import {BaseTest} from "./Base.t.sol";

/// SC-86: a full close through the router must not need a fresh oracle price, because Morpho itself
/// does not read the oracle once the debt is zero. A partial close and a keeper reduction still do.
contract StaleCloseTest is BaseTest {
    int128 internal constant PRICE = 600e8;

    /// Past the 2 hour open clock of the test oracles, so price() reverts.
    function _makeOracleStale() internal {
        _mockOracle(Session.Regular, 3 hours, 3 hours, PRICE);
        vm.expectRevert();
        longOracle.price();
    }

    function _longClose(uint256 shares, uint256 assets) internal view returns (IMarginRouter.CloseParams memory) {
        return IMarginRouter.CloseParams({
            marketId: longId,
            repayShares: shares,
            withdrawAssets: assets,
            swapAmountIn: assets,
            swap: _swapData(AQQQ, USDC, assets, _usdcFor(assets, 0)),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function _openShort() internal returns (uint256 borrow) {
        borrow = _stockFor(50e6, 0);
        IMarginRouter.OpenParams memory p = IMarginRouter.OpenParams({
            marketId: shortId,
            margin: 100e6,
            borrowAssets: borrow,
            swap: _swapData(AQQQ, USDC, borrow, _usdcFor(borrow, 0)),
            maxLtv: SOFT_OPEN,
            deadline: vm.getBlockTimestamp() + 60
        });
        vm.prank(user);
        router.openShort(p);
    }

    function _shortClose(uint256 shares, uint256 assets, uint256 buyBack)
        internal
        view
        returns (IMarginRouter.CloseParams memory)
    {
        uint256 spend = _usdcFor(buyBack, 0) + 1;
        return IMarginRouter.CloseParams({
            marketId: shortId,
            repayShares: shares,
            withdrawAssets: assets,
            swapAmountIn: spend,
            swap: _swapData(USDC, AQQQ, spend, buyBack),
            minReturn: 0,
            deadline: vm.getBlockTimestamp() + 60
        });
    }

    function test_fullLongCloseWorksWithAStaleOracle() public {
        uint256 collateral = _openLong(100e6, 100e6);
        IMarginRouter.CloseParams memory p = _longClose(type(uint256).max, collateral);
        _makeOracleStale();

        vm.prank(user);
        uint256 returned = router.closeLong(p);

        Position memory position = _position(longId);
        assertEq(position.collateral, 0);
        assertEq(position.borrowShares, 0);
        assertGt(returned, 0);
        _assertRouterEmpty();
    }

    function test_partialLongCloseStillNeedsAFreshPrice() public {
        uint256 collateral = _openLong(100e6, 100e6);
        IMarginRouter.CloseParams memory p = _longClose(_position(longId).borrowShares / 2, collateral / 2);
        _makeOracleStale();

        vm.prank(user);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        router.closeLong(p);
    }

    function test_fullShortCloseWorksWithAStaleOracle() public {
        uint256 borrow = _openShort();
        IMarginRouter.CloseParams memory p = _shortClose(type(uint256).max, type(uint256).max, borrow + 1e12);
        _makeOracleStale();

        vm.prank(user);
        router.closeShort(p);

        Position memory position = _position(shortId);
        assertEq(position.collateral, 0);
        assertEq(position.borrowShares, 0);
        _assertRouterEmpty();
    }

    function test_partialShortCloseStillNeedsAFreshPrice() public {
        uint256 borrow = _openShort();
        Position memory before = _position(shortId);
        IMarginRouter.CloseParams memory p = _shortClose(before.borrowShares / 2, before.collateral / 4, borrow / 2);
        _makeOracleStale();

        vm.prank(user);
        vm.expectPartialRevert(ISessionOracle.OracleStale.selector);
        router.closeShort(p);
    }

    function test_closeEventCarriesZeroWhenTheOracleCannotBeRead() public {
        uint256 collateral = _openLong(100e6, 100e6);
        IMarginRouter.CloseParams memory p = _longClose(type(uint256).max, collateral);
        vm.mockCallRevert(address(longOracle), abi.encodeWithSelector(ISessionOracle.snapshot.selector), "down");
        vm.mockCallRevert(address(longOracle), abi.encodeWithSelector(longOracle.price.selector), "down");

        vm.prank(user);
        router.closeLong(p);
        assertEq(_position(longId).borrowShares, 0);
        _assertRouterEmpty();
    }
}
