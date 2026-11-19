// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {Swap} from "./Types.sol";

interface ILiquidator {
    event Liquidated(
        Id indexed marketId,
        address indexed borrower,
        uint256 seizedAssets,
        uint256 repaidAssets,
        int256 loanTokenDelta,
        uint256 collateralLeft,
        address keeper
    );

    error Unauthorized();
    error NotMorpho();
    error SwapTargetNotAllowed(address target);
    error InsufficientSwapOutput(uint256 out, uint256 minOut);
    error InsufficientResult(int256 loanTokenDelta, uint256 collateralLeft);
    error LossTooLarge(int256 loanTokenDelta, uint256 budget);

    event LossBudgetSet(address indexed token, uint256 budget);
    event LossBudgetSpent(address indexed token, uint256 loss, uint256 remaining);

    function lossBudgetOf(address token) external view returns (uint256);

    function addLossBudget(address token, uint256 amount) external;

    function clearLossBudget(address token) external;

    /// Seizes collateral from an unhealthy position, swaps swapAmountIn of it into the loan token and repays.
    /// loanTokenDelta may be negative: the contract then covers the shortfall from its own balance, up to the
    /// loss budget the owner set for the loan token (zero by default), which the loss spends.
    function liquidate(
        Id marketId,
        address borrower,
        uint256 seizedAssets,
        uint256 swapAmountIn,
        Swap calldata swap,
        int256 minLoanTokenDelta,
        uint256 minCollateralLeft
    ) external returns (int256 loanTokenDelta, uint256 collateralLeft);

    function isKeeper(address keeper) external view returns (bool);

    function treasury() external view returns (address);
}
