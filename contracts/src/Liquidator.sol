// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Id, IMorpho, MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMorphoLiquidateCallback} from "morpho-blue/src/interfaces/IMorphoCallbacks.sol";
import {ILiquidator} from "./interfaces/ILiquidator.sol";
import {Swap} from "./interfaces/Types.sol";

/// Liquidates unhealthy positions in Morpho markets without capital of its own:
/// Morpho hands over the seized collateral first, it is swapped, and the debt is repaid in the same call.
/// Holds no user funds. Whatever it earns goes to the treasury.
contract Liquidator is ILiquidator, IMorphoLiquidateCallback, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IMorpho public immutable MORPHO;
    address public immutable SWAP_TARGET;

    address public treasury;
    mapping(address => bool) public isKeeper;

    bool private transient _active;

    event KeeperSet(address keeper, bool allowed);
    event TreasurySet(address treasury);

    error InvalidParams();

    constructor(IMorpho morpho, address swapTarget, address owner_, address treasury_) Ownable(owner_) {
        if (swapTarget == address(morpho) || swapTarget == address(0) || treasury_ == address(0)) {
            revert InvalidParams();
        }
        MORPHO = morpho;
        SWAP_TARGET = swapTarget;
        treasury = treasury_;
    }

    function liquidate(
        Id marketId,
        address borrower,
        uint256 seizedAssets,
        uint256 swapAmountIn,
        Swap calldata swap,
        int256 minLoanTokenDelta,
        uint256 minCollateralLeft
    ) external nonReentrant returns (int256 loanTokenDelta, uint256 collateralLeft) {
        if (!isKeeper[msg.sender]) revert Unauthorized();
        MarketParams memory mp = MORPHO.idToMarketParams(marketId);
        IERC20 loan = IERC20(mp.loanToken);
        IERC20 collateral = IERC20(mp.collateralToken);
        uint256 loanBefore = loan.balanceOf(address(this));
        uint256 collateralBefore = collateral.balanceOf(address(this));

        _active = true;
        (, uint256 repaidAssets) = MORPHO.liquidate(mp, borrower, seizedAssets, 0, abi.encode(mp, swapAmountIn, swap));
        _active = false;

        uint256 loanAfter = loan.balanceOf(address(this));
        loanTokenDelta = int256(loanAfter) - int256(loanBefore);
        collateralLeft = collateral.balanceOf(address(this)) - collateralBefore;
        if (loanTokenDelta < minLoanTokenDelta || collateralLeft < minCollateralLeft) {
            revert InsufficientResult(loanTokenDelta, collateralLeft);
        }

        if (loanTokenDelta > 0) loan.safeTransfer(treasury, uint256(loanTokenDelta));
        if (collateralLeft > 0) collateral.safeTransfer(treasury, collateralLeft);
        emit Liquidated(marketId, borrower, seizedAssets, repaidAssets, loanTokenDelta, collateralLeft, msg.sender);
    }

    function onMorphoLiquidate(uint256 repaidAssets, bytes calldata data) external {
        if (msg.sender != address(MORPHO)) revert NotMorpho();
        if (!_active) revert Unauthorized();
        (MarketParams memory mp, uint256 swapAmountIn, Swap memory swap) =
            abi.decode(data, (MarketParams, uint256, Swap));
        if (swapAmountIn > 0) _swap(mp.collateralToken, mp.loanToken, swapAmountIn, swap);
        IERC20(mp.loanToken).forceApprove(address(MORPHO), repaidAssets);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert InvalidParams();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// Takes back the float the owner put in to cover loss-making liquidations.
    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, Swap memory swap) private {
        if (swap.target != SWAP_TARGET) revert SwapTargetNotAllowed(swap.target);
        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(swap.target, amountIn);
        (bool ok, bytes memory result) = swap.target.call(swap.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        IERC20(tokenIn).forceApprove(swap.target, 0);
        uint256 out = IERC20(tokenOut).balanceOf(address(this)) - beforeOut;
        if (out < swap.minOut) revert InsufficientSwapOutput(out, swap.minOut);
    }
}
