// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    Authorization,
    Id,
    IMorpho,
    Market,
    MarketParams,
    Position,
    Signature
} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IMorphoFlashLoanCallback} from "morpho-blue/src/interfaces/IMorphoCallbacks.sol";
import {SharesMathLib} from "morpho-blue/src/libraries/SharesMathLib.sol";
import {IMarginRouter} from "./interfaces/IMarginRouter.sol";
import {IRiskManager} from "./interfaces/IRiskManager.sol";
import {ISessionOracle} from "./interfaces/ISessionOracle.sol";
import {Side, Swap} from "./interfaces/Types.sol";

/// Opens and closes leveraged stock positions in one transaction.
/// Positions stay in the user's own Morpho account. This contract acts through the Morpho
/// authorization the user grants, and holds no tokens between transactions.
contract MarginRouter is IMarginRouter, IMorphoFlashLoanCallback, Ownable2Step, ReentrancyGuardTransient, Multicall {
    using SafeERC20 for IERC20;
    using SharesMathLib for uint256;

    enum Action {
        OpenLong,
        CloseLong,
        OpenShort,
        CloseShort
    }

    struct Close {
        Id marketId;
        MarketParams mp;
        address user;
        uint256 shares;
        uint256 repayAssets;
        uint256 withdrawAssets;
        uint256 swapAmountIn;
        uint256 minReturn;
        uint256 feeBps;
        address feeTo;
        uint8 reason;
    }

    uint256 private constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 50;
    uint256 public constant MAX_KEEPER_FEE_BPS = 30;
    uint8 private constant REASON_USER = 0;
    uint8 private constant REASON_PROTECTION = 1;

    IMorpho public immutable MORPHO;
    IRiskManager public immutable RISK;
    /// The only contract swap calldata may be sent to. Fixed so no one can point it at Morpho or a token.
    address public immutable SWAP_TARGET;

    uint256 public feeBps;
    uint256 public keeperFeeBps;
    address public feeRecipient;
    mapping(address => bool) public isKeeper;
    mapping(address => mapping(Id => bool)) public protectionEnabled;

    bool private transient _flashActive;
    uint256 private transient _swapOut;

    event FeeSet(uint256 feeBps, uint256 keeperFeeBps, address feeRecipient);
    event KeeperSet(address keeper, bool allowed);

    error InvalidParams();
    error WrongSide(Id marketId);

    constructor(
        IMorpho morpho,
        IRiskManager risk,
        address swapTarget,
        address owner_,
        address feeRecipient_,
        uint256 feeBps_
    ) Ownable(owner_) {
        if (swapTarget == address(morpho) || swapTarget == address(0) || feeRecipient_ == address(0)) {
            revert InvalidParams();
        }
        if (feeBps_ > MAX_FEE_BPS) revert InvalidParams();
        MORPHO = morpho;
        RISK = risk;
        SWAP_TARGET = swapTarget;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    // ----- user entry points -----

    function openLong(OpenParams calldata p) external nonReentrant returns (uint256 collateralAdded, uint256 ltvAfter) {
        _checkDeadline(p.deadline);
        MarketParams memory mp = _market(p.marketId, Side.Long);
        IERC20 quote = IERC20(mp.loanToken);

        quote.safeTransferFrom(msg.sender, address(this), p.margin);
        uint256 fee = (p.margin + p.borrowAssets) * feeBps / BPS;
        if (fee > 0) quote.safeTransfer(feeRecipient, fee);
        uint256 swapIn = p.margin + p.borrowAssets - fee;

        bytes memory data = abi.encode(Action.OpenLong, abi.encode(msg.sender, mp, swapIn, p.borrowAssets, p.swap));
        _run(mp.loanToken, p.borrowAssets, data);
        collateralAdded = _swapOut;

        uint256 execPriceE8 = _priceE8(swapIn, collateralAdded, mp.loanToken, mp.collateralToken);
        ltvAfter = _checkOpened(p.marketId, p.maxLtv, execPriceE8);
        emit PositionOpened(
            msg.sender,
            p.marketId,
            Side.Long,
            p.margin,
            collateralAdded,
            p.borrowAssets,
            execPriceE8,
            _oraclePriceE8(mp.oracle),
            fee,
            ltvAfter
        );
        _sweep(mp, msg.sender);
    }

    function openShort(OpenParams calldata p) external nonReentrant returns (uint256 debtAdded, uint256 ltvAfter) {
        _checkDeadline(p.deadline);
        MarketParams memory mp = _market(p.marketId, Side.Short);
        IERC20 quote = IERC20(mp.collateralToken);

        quote.safeTransferFrom(msg.sender, address(this), p.margin);
        // Flash the guaranteed sale proceeds, net of the fee, so they count as collateral before the stock is borrowed.
        uint256 flash = p.swap.minOut * (BPS - feeBps) / BPS;
        bytes memory data =
            abi.encode(Action.OpenShort, abi.encode(msg.sender, mp, p.margin + flash, p.borrowAssets, p.swap, flash));
        _run(mp.collateralToken, flash, data);
        uint256 proceeds = _swapOut;
        uint256 fee = proceeds * feeBps / BPS;
        debtAdded = p.borrowAssets;

        uint256 execPriceE8 = _priceE8(proceeds, p.borrowAssets, mp.collateralToken, mp.loanToken);
        ltvAfter = _checkOpened(p.marketId, p.maxLtv, execPriceE8);
        emit PositionOpened(
            msg.sender,
            p.marketId,
            Side.Short,
            p.margin,
            p.margin + proceeds - fee,
            p.borrowAssets,
            execPriceE8,
            _oraclePriceE8(mp.oracle),
            fee,
            ltvAfter
        );
        _sweep(mp, msg.sender);
    }

    function closeLong(CloseParams calldata p) external nonReentrant returns (uint256 returned) {
        returned = _close(msg.sender, p, Side.Long, REASON_USER);
    }

    function closeShort(CloseParams calldata p) external nonReentrant returns (uint256 returned) {
        returned = _close(msg.sender, p, Side.Short, REASON_USER);
    }

    function addCollateral(Id marketId, uint256 assets) external nonReentrant {
        MarketParams memory mp = _anyMarket(marketId);
        IERC20 collateral = IERC20(mp.collateralToken);
        collateral.safeTransferFrom(msg.sender, address(this), assets);
        collateral.forceApprove(address(MORPHO), assets);
        MORPHO.supplyCollateral(mp, assets, msg.sender, "");
        emit CollateralAdded(msg.sender, marketId, assets);
    }

    function removeCollateral(Id marketId, uint256 assets) external nonReentrant {
        MarketParams memory mp = _anyMarket(marketId);
        MORPHO.withdrawCollateral(mp, assets, msg.sender, msg.sender);
        uint256 ltv = RISK.positionLtv(marketId, msg.sender);
        uint256 soft = RISK.currentSoftLtv(marketId);
        if (ltv > soft) revert IRiskManager.SoftLimitExceeded(ltv, soft);
        emit CollateralRemoved(msg.sender, marketId, assets);
    }

    function setProtection(Id marketId, bool enabled) external {
        _anyMarket(marketId);
        protectionEnabled[msg.sender][marketId] = enabled;
        emit ProtectionSet(msg.sender, marketId, enabled);
    }

    // ----- keeper -----

    function deleverage(address user, CloseParams calldata p) external nonReentrant {
        if (!isKeeper[msg.sender]) revert Unauthorized();
        if (!protectionEnabled[user][p.marketId]) revert ProtectionNotEnabled(user, p.marketId);
        uint256 ltv = RISK.positionLtv(p.marketId, user);
        uint256 soft = RISK.currentSoftLtv(p.marketId);
        if (ltv <= soft) revert PositionHealthy(ltv, soft);
        _close(user, p, RISK.config(p.marketId).side, REASON_PROTECTION);
    }

    // ----- first use helpers, meant to be batched with multicall -----

    function permitToken(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        // A permit that was already submitted by someone else must not fail the batch.
        try IERC20Permit(token).permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
    }

    function authorizeWithSig(
        address authorizer,
        bool isAuthorized,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (authorizer != msg.sender) revert Unauthorized();
        Authorization memory authorization = Authorization(authorizer, address(this), isAuthorized, nonce, deadline);
        try MORPHO.setAuthorizationWithSig(authorization, Signature(v, r, s)) {} catch {}
        if (MORPHO.isAuthorized(authorizer, address(this)) != isAuthorized) revert Unauthorized();
    }

    function multicall(bytes[] calldata data) public override(IMarginRouter, Multicall) returns (bytes[] memory) {
        return super.multicall(data);
    }

    // ----- owner -----

    function setFees(uint256 feeBps_, uint256 keeperFeeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS || keeperFeeBps_ > MAX_KEEPER_FEE_BPS || feeRecipient_ == address(0)) {
            revert InvalidParams();
        }
        feeBps = feeBps_;
        keeperFeeBps = keeperFeeBps_;
        feeRecipient = feeRecipient_;
        emit FeeSet(feeBps_, keeperFeeBps_, feeRecipient_);
    }

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        isKeeper[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    // ----- views -----

    function isSwapTarget(address target) public view returns (bool) {
        return target == SWAP_TARGET;
    }

    // ----- Morpho callback -----

    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external {
        if (msg.sender != address(MORPHO)) revert NotMorpho();
        if (!_flashActive) revert Unauthorized();
        address flashToken = _step(data);
        IERC20(flashToken).forceApprove(address(MORPHO), assets);
    }

    // ----- internals -----

    /// Runs one step inside a Morpho flash loan, or directly when nothing needs to be flashed.
    function _run(address token, uint256 flashAssets, bytes memory data) private {
        if (flashAssets == 0) {
            _step(data);
            return;
        }
        _flashActive = true;
        MORPHO.flashLoan(token, flashAssets, data);
        _flashActive = false;
    }

    function _step(bytes memory data) private returns (address flashToken) {
        (Action action, bytes memory inner) = abi.decode(data, (Action, bytes));
        if (action == Action.OpenLong) return _stepOpenLong(inner);
        if (action == Action.OpenShort) return _stepOpenShort(inner);
        if (action == Action.CloseLong) return _stepCloseLong(inner);
        return _stepCloseShort(inner);
    }

    function _stepOpenLong(bytes memory inner) private returns (address) {
        (address user, MarketParams memory mp, uint256 swapIn, uint256 borrowAssets, Swap memory swap) =
            abi.decode(inner, (address, MarketParams, uint256, uint256, Swap));
        uint256 out = _swap(mp.loanToken, mp.collateralToken, swapIn, swap);
        IERC20(mp.collateralToken).forceApprove(address(MORPHO), out);
        MORPHO.supplyCollateral(mp, out, user, "");
        if (borrowAssets > 0) MORPHO.borrow(mp, borrowAssets, 0, user, address(this));
        _swapOut = out;
        return mp.loanToken;
    }

    function _stepOpenShort(bytes memory inner) private returns (address) {
        (
            address user,
            MarketParams memory mp,
            uint256 supplied,
            uint256 borrowAssets,
            Swap memory swap,
            uint256 flashed
        ) = abi.decode(inner, (address, MarketParams, uint256, uint256, Swap, uint256));
        IERC20 quote = IERC20(mp.collateralToken);

        quote.forceApprove(address(MORPHO), supplied);
        MORPHO.supplyCollateral(mp, supplied, user, "");
        MORPHO.borrow(mp, borrowAssets, 0, user, address(this));

        uint256 proceeds = _swap(mp.loanToken, mp.collateralToken, borrowAssets, swap);
        uint256 fee = proceeds * feeBps / BPS;
        if (fee > 0) quote.safeTransfer(feeRecipient, fee);
        uint256 surplus = proceeds - fee - flashed;
        if (surplus > 0) {
            quote.forceApprove(address(MORPHO), surplus);
            MORPHO.supplyCollateral(mp, surplus, user, "");
        }
        _swapOut = proceeds;
        return mp.collateralToken;
    }

    function _stepCloseLong(bytes memory inner) private returns (address) {
        (Close memory c, Swap memory swap) = abi.decode(inner, (Close, Swap));
        if (c.shares > 0) {
            IERC20(c.mp.loanToken).forceApprove(address(MORPHO), c.repayAssets);
            MORPHO.repay(c.mp, 0, c.shares, c.user, "");
        }
        MORPHO.withdrawCollateral(c.mp, c.withdrawAssets, c.user, address(this));
        _swapOut = c.swapAmountIn > 0 ? _swap(c.mp.collateralToken, c.mp.loanToken, c.swapAmountIn, swap) : 0;
        return c.mp.loanToken;
    }

    function _stepCloseShort(bytes memory inner) private returns (address) {
        (Close memory c, Swap memory swap) = abi.decode(inner, (Close, Swap));
        uint256 bought = c.swapAmountIn > 0 ? _swap(c.mp.collateralToken, c.mp.loanToken, c.swapAmountIn, swap) : 0;
        if (c.shares > 0) {
            IERC20(c.mp.loanToken).forceApprove(address(MORPHO), c.repayAssets);
            MORPHO.repay(c.mp, 0, c.shares, c.user, "");
        }
        MORPHO.withdrawCollateral(c.mp, c.withdrawAssets, c.user, address(this));
        _swapOut = bought;
        return c.mp.collateralToken;
    }

    function _close(address user, CloseParams calldata p, Side side, uint8 reason) private returns (uint256 returned) {
        _checkDeadline(p.deadline);
        Close memory c;
        c.marketId = p.marketId;
        c.mp = _market(p.marketId, side);
        c.user = user;
        c.minReturn = p.minReturn;
        c.reason = reason;
        (c.feeBps, c.feeTo) = reason == REASON_USER ? (feeBps, feeRecipient) : (keeperFeeBps, msg.sender);

        MORPHO.accrueInterest(c.mp);
        Position memory position = MORPHO.position(p.marketId, user);
        Market memory market = MORPHO.market(p.marketId);
        c.shares = p.repayShares == type(uint256).max ? position.borrowShares : p.repayShares;
        c.repayAssets = c.shares.toAssetsUp(market.totalBorrowAssets, market.totalBorrowShares);
        c.withdrawAssets = p.withdrawAssets == type(uint256).max ? position.collateral : p.withdrawAssets;

        uint256 ltvBefore = RISK.positionLtv(p.marketId, user);
        if (side == Side.Long) {
            c.swapAmountIn = p.swapAmountIn == type(uint256).max ? c.withdrawAssets : p.swapAmountIn;
            if (c.swapAmountIn > c.withdrawAssets) revert InvalidParams();
            _run(c.mp.loanToken, c.repayAssets, abi.encode(Action.CloseLong, abi.encode(c, p.swap)));
            returned = _settleCloseLong(c, ltvBefore);
        } else {
            if (p.swapAmountIn == type(uint256).max) revert InvalidParams();
            c.swapAmountIn = p.swapAmountIn;
            _run(c.mp.collateralToken, c.swapAmountIn, abi.encode(Action.CloseShort, abi.encode(c, p.swap)));
            returned = _settleCloseShort(c, ltvBefore);
        }
    }

    function _settleCloseLong(Close memory c, uint256 ltvBefore) private returns (uint256 returned) {
        uint256 proceeds = _swapOut;
        IERC20 quote = IERC20(c.mp.loanToken);
        uint256 fee = proceeds * c.feeBps / BPS;
        uint256 balance = quote.balanceOf(address(this));
        if (balance < fee + c.minReturn) revert InsufficientReturn(balance > fee ? balance - fee : 0, c.minReturn);
        if (fee > 0) quote.safeTransfer(c.feeTo, fee);
        returned = balance - fee;

        uint256 execPriceE8 =
            c.swapAmountIn > 0 ? _priceE8(proceeds, c.swapAmountIn, c.mp.loanToken, c.mp.collateralToken) : 0;
        uint256 ltvAfter = _checkReduced(c, ltvBefore, execPriceE8);
        emit PositionReduced(
            c.user,
            c.marketId,
            Side.Long,
            c.withdrawAssets,
            c.repayAssets,
            returned,
            execPriceE8,
            _oraclePriceE8(c.mp.oracle),
            fee,
            ltvAfter,
            c.reason,
            msg.sender
        );
        _sweep(c.mp, c.user);
    }

    function _settleCloseShort(Close memory c, uint256 ltvBefore) private returns (uint256 returned) {
        uint256 bought = _swapOut;
        IERC20 quote = IERC20(c.mp.collateralToken);
        uint256 fee = c.swapAmountIn * c.feeBps / BPS;
        uint256 balance = quote.balanceOf(address(this));
        if (balance < fee + c.minReturn) revert InsufficientReturn(balance > fee ? balance - fee : 0, c.minReturn);
        if (fee > 0) quote.safeTransfer(c.feeTo, fee);
        returned = balance - fee;

        uint256 execPriceE8 = bought > 0 ? _priceE8(c.swapAmountIn, bought, c.mp.collateralToken, c.mp.loanToken) : 0;
        uint256 ltvAfter = _checkReduced(c, ltvBefore, execPriceE8);
        emit PositionReduced(
            c.user,
            c.marketId,
            Side.Short,
            c.withdrawAssets,
            c.repayAssets,
            returned,
            execPriceE8,
            _oraclePriceE8(c.mp.oracle),
            fee,
            ltvAfter,
            c.reason,
            msg.sender
        );
        _sweep(c.mp, c.user);
    }

    function _checkOpened(Id marketId, uint256 maxLtv, uint256 execPriceE8) private view returns (uint256 ltvAfter) {
        RISK.checkOpen(marketId, msg.sender, execPriceE8);
        ltvAfter = RISK.positionLtv(marketId, msg.sender);
        if (ltvAfter > maxLtv) revert UserLimitExceeded(ltvAfter, maxLtv);
    }

    /// A reduction may never leave the position worse off than before and above the soft limit.
    /// A keeper reduction must also trade near the oracle price and must lower the LTV.
    function _checkReduced(Close memory c, uint256 ltvBefore, uint256 execPriceE8)
        private
        view
        returns (uint256 ltvAfter)
    {
        ltvAfter = RISK.positionLtv(c.marketId, c.user);
        if (c.reason == REASON_USER) {
            if (ltvAfter > ltvBefore) {
                uint256 soft = RISK.currentSoftLtv(c.marketId);
                if (ltvAfter > soft) revert IRiskManager.SoftLimitExceeded(ltvAfter, soft);
            }
            return ltvAfter;
        }
        if (ltvAfter >= ltvBefore) revert PositionHealthy(ltvAfter, ltvBefore);
        uint256 oraclePriceE8 = _oraclePriceE8(c.mp.oracle);
        uint256 diff = execPriceE8 > oraclePriceE8 ? execPriceE8 - oraclePriceE8 : oraclePriceE8 - execPriceE8;
        uint256 deviationBps = Math.mulDiv(diff, BPS, oraclePriceE8);
        uint256 maxBps = RISK.config(c.marketId).maxDeviationBps;
        if (execPriceE8 == 0 || deviationBps > maxBps) revert IRiskManager.PriceDeviationTooHigh(deviationBps, maxBps);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn, Swap memory swap)
        private
        returns (uint256 out)
    {
        if (!isSwapTarget(swap.target)) revert SwapTargetNotAllowed(swap.target);
        uint256 beforeOut = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).forceApprove(swap.target, amountIn);
        (bool ok, bytes memory result) = swap.target.call(swap.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        IERC20(tokenIn).forceApprove(swap.target, 0);
        out = IERC20(tokenOut).balanceOf(address(this)) - beforeOut;
        if (out < swap.minOut) revert InsufficientSwapOutput(out, swap.minOut);
    }

    /// Sends everything this contract still holds of the two market tokens to the user.
    function _sweep(MarketParams memory mp, address to) private {
        _sweepToken(mp.loanToken, to);
        _sweepToken(mp.collateralToken, to);
    }

    function _sweepToken(address token, address to) private {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) IERC20(token).safeTransfer(to, balance);
    }

    function _market(Id marketId, Side side) private view returns (MarketParams memory mp) {
        IRiskManager.MarketConfig memory c = RISK.config(marketId);
        if (c.oracle == address(0)) revert IRiskManager.MarketNotEnabled(marketId);
        if (c.side != side) revert WrongSide(marketId);
        mp = MORPHO.idToMarketParams(marketId);
    }

    function _anyMarket(Id marketId) private view returns (MarketParams memory) {
        if (RISK.config(marketId).oracle == address(0)) revert IRiskManager.MarketNotEnabled(marketId);
        return MORPHO.idToMarketParams(marketId);
    }

    /// Quote token per stock token as a dollar price with 8 decimals.
    function _priceE8(uint256 quoteAmount, uint256 stockAmount, address quoteToken, address stockToken)
        private
        view
        returns (uint256)
    {
        uint256 quoteUnit = 10 ** IERC20Metadata(quoteToken).decimals();
        uint256 stockUnit = 10 ** IERC20Metadata(stockToken).decimals();
        return Math.mulDiv(quoteAmount * 1e8, stockUnit, stockAmount * quoteUnit);
    }

    function _oraclePriceE8(address oracle) private view returns (uint256 priceE8) {
        (priceE8,,,,,,) = ISessionOracle(oracle).snapshot();
    }

    function _checkDeadline(uint256 deadline) private view {
        if (block.timestamp > deadline) revert DeadlineExpired();
    }
}
