// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {Side, Swap} from "./Types.sol";

interface IMarginRouter {
    /// margin is USDC. borrowAssets is USDC for long and stock for short.
    /// swap is USDC to stock for long and stock to USDC for short. maxLtv is WAD.
    struct OpenParams {
        Id marketId;
        uint256 margin;
        uint256 borrowAssets;
        Swap swap;
        uint256 maxLtv;
        uint256 deadline;
    }

    /// type(uint256).max means all for repayShares and withdrawAssets.
    /// swapAmountIn is stock sold for long and USDC spent for short. minReturn is USDC.
    struct CloseParams {
        Id marketId;
        uint256 repayShares;
        uint256 withdrawAssets;
        uint256 swapAmountIn;
        Swap swap;
        uint256 minReturn;
        uint256 deadline;
    }

    event PositionOpened(
        address indexed user,
        Id indexed marketId,
        Side side,
        uint256 margin,
        uint256 collateralDelta,
        uint256 debtDelta,
        uint256 execPriceE8,
        uint256 oraclePriceE8,
        uint256 fee,
        uint256 ltvAfter
    );

    /// reason: 0 = user, 1 = auto-deleverage.
    event PositionReduced(
        address indexed user,
        Id indexed marketId,
        Side side,
        uint256 collateralDelta,
        uint256 debtDelta,
        uint256 returned,
        uint256 execPriceE8,
        uint256 oraclePriceE8,
        uint256 fee,
        uint256 ltvAfter,
        uint8 reason,
        address caller
    );

    event CollateralAdded(address indexed user, Id indexed marketId, uint256 assets);
    event CollateralRemoved(address indexed user, Id indexed marketId, uint256 assets);
    event ProtectionSet(address indexed user, Id indexed marketId, bool enabled);

    error DeadlineExpired();
    error SwapTargetNotAllowed(address target);
    error InsufficientSwapOutput(uint256 out, uint256 minOut);
    error UserLimitExceeded(uint256 ltv, uint256 maxLtv);
    error ProtectionNotEnabled(address user, Id marketId);
    error PositionHealthy(uint256 ltv, uint256 softLtv);
    error InsufficientReturn(uint256 returned, uint256 minReturn);
    error NotMorpho();
    error Unauthorized();

    function openLong(OpenParams calldata p) external returns (uint256 collateralAdded, uint256 ltvAfter);

    function openShort(OpenParams calldata p) external returns (uint256 debtAdded, uint256 ltvAfter);

    function closeLong(CloseParams calldata p) external returns (uint256 returned);

    function closeShort(CloseParams calldata p) external returns (uint256 returned);

    function addCollateral(Id marketId, uint256 assets) external;

    function removeCollateral(Id marketId, uint256 assets) external;

    function setProtection(Id marketId, bool enabled) external;

    function protectionEnabled(address user, Id marketId) external view returns (bool);

    /// Keeper only. Requires protection on, LTV above the soft limit, and a swap price within the deviation bound.
    function deleverage(address user, CloseParams calldata p) external;

    function multicall(bytes[] calldata data) external returns (bytes[] memory);

    function permitToken(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

    function authorizeWithSig(
        address authorizer,
        bool isAuthorized,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    function feeBps() external view returns (uint256);

    function keeperFeeBps() external view returns (uint256);

    function isSwapTarget(address target) external view returns (bool);
}
