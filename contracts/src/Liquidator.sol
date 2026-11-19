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
import {SwapTargets} from "./SwapTargets.sol";

/// Liquidates unhealthy positions in Morpho markets without capital of its own:
/// Morpho hands over the seized collateral first, it is swapped, and the debt is repaid in the same call.
/// Holds no user funds. Whatever it earns goes to the treasury.
contract Liquidator is ILiquidator, IMorphoLiquidateCallback, Ownable2Step, ReentrancyGuardTransient, SwapTargets {
    using SafeERC20 for IERC20;

    IMorpho public immutable MORPHO;

    address public treasury;
    mapping(address => bool) public isKeeper;
    /// Loan token base units the float may still lose, across all liquidations. Each loss spends it and only
    /// the owner refills it. Zero by default, so a keeper key alone can never spend the float.
    mapping(address => uint256) public lossBudgetOf;

    bool private transient _active;

    event KeeperSet(address keeper, bool allowed);
    event TreasurySet(address treasury);

    error InvalidParams();

    constructor(
        IMorpho morpho,
        address[] memory swapTargets_,
        address[] memory swapSpenders_,
        address owner_,
        address treasury_
    ) Ownable(owner_) SwapTargets(swapTargets_, swapSpenders_, address(morpho)) {
        if (treasury_ == address(0)) revert InvalidParams();
        MORPHO = morpho;
        treasury = treasury_;
    }

    function isSwapTarget(address target) external view returns (bool) {
        return _isSwapTarget(target);
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
        if (mp.loanToken == mp.collateralToken) revert InvalidParams();
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
        if (loanTokenDelta < 0) {
            uint256 budget = lossBudgetOf[mp.loanToken];
            uint256 loss = uint256(-loanTokenDelta);
            if (loss > budget) revert LossTooLarge(loanTokenDelta, budget);
            lossBudgetOf[mp.loanToken] = budget - loss;
            emit LossBudgetSpent(mp.loanToken, loss, budget - loss);
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

    /// Adds to whatever the budget is when the call runs, so a refill scheduled through the timelock still
    /// applies after losses during the delay.
    function addLossBudget(address token, uint256 amount) external onlyOwner {
        uint256 budget = lossBudgetOf[token] + amount;
        lossBudgetOf[token] = budget;
        emit LossBudgetSet(token, budget);
    }

    function clearLossBudget(address token) external onlyOwner {
        lossBudgetOf[token] = 0;
        emit LossBudgetSet(token, 0);
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
        if (!_isSwapTarget(swap.target)) revert SwapTargetNotAllowed(swap.target);
        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        address spender = swapSpender(swap.target);
        IERC20(tokenIn).forceApprove(spender, amountIn);
        (bool ok, bytes memory result) = swap.target.call(swap.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        IERC20(tokenIn).forceApprove(spender, 0);
        uint256 out = IERC20(tokenOut).balanceOf(address(this)) - beforeOut;
        if (out < swap.minOut) revert InsufficientSwapOutput(out, swap.minOut);
    }
}
