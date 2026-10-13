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

    /// Seizes collateral from an unhealthy position, swaps swapAmountIn of it into the loan token and repays.
    /// loanTokenDelta may be negative: the contract then covers the shortfall from its own balance.
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
