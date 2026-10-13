// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Id, IMorpho, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {IOracle} from "morpho-blue/src/interfaces/IOracle.sol";
import {MorphoBalancesLib} from "morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";
import {IRiskManager} from "./interfaces/IRiskManager.sol";
import {ISessionOracle} from "./interfaces/ISessionOracle.sol";
import {Session, Side} from "./interfaces/Types.sol";

/// Soft limits that follow market hours. They bind positions opened through the router only.
/// The hard limit lives in Morpho and is not affected by anything here.
contract RiskManager is IRiskManager, Ownable2Step {
    using MorphoBalancesLib for IMorpho;

    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;
    uint256 private constant ORACLE_PRICE_SCALE = 1e36;

    uint64 public constant MAX_CLOSE_HORIZON = 8 days;
    uint32 public constant MAX_PRE_CLOSE_WINDOW = 1 days;
    /// After nextCloseAt passes, the pre-close regime holds this long, then the oracle session decides.
    uint32 public constant CLOSE_GRACE = 1 hours;

    IMorpho public immutable MORPHO;

    address public guardian;
    address public calendarPoster;
    address public oracleAgePoster;
    uint64 public nextCloseAt;
    uint32 public preCloseWindow;
    bool public openingPaused;

    struct OracleAgeBounds {
        uint32 min;
        uint32 cap;
    }

    mapping(Id => MarketConfig) private _config;
    mapping(Id => OracleAgeBounds) private _oracleAgeBounds;
    Id[] private _marketIds;

    event GuardianSet(address guardian);
    event CalendarPosterSet(address calendarPoster);
    event OracleAgePosterSet(address oracleAgePoster);
    event PreCloseWindowSet(uint32 preCloseWindow);

    error InvalidConfig();
    error NotTightening();
    error InvalidCloseTime();

    constructor(IMorpho morpho, address owner_, uint32 preCloseWindow_) Ownable(owner_) {
        if (preCloseWindow_ > MAX_PRE_CLOSE_WINDOW) revert InvalidConfig();
        MORPHO = morpho;
        preCloseWindow = preCloseWindow_;
    }

    function config(Id id) external view returns (MarketConfig memory) {
        return _config[id];
    }

    function marketIds() external view returns (Id[] memory) {
        return _marketIds;
    }

    function oracleAgeBounds(Id id) external view returns (uint32 minOracleAge, uint32 capOracleAge) {
        OracleAgeBounds memory b = _oracleAgeBounds[id];
        return (b.min, b.cap);
    }

    function isClosedRegime() public view returns (bool) {
        if (_inPreClose()) return true;
        if (_marketIds.length == 0) return false;
        return _sessionClosed(_config[_marketIds[0]].oracle);
    }

    function currentSoftLtv(Id id) public view returns (uint256) {
        MarketConfig memory c = _config[id];
        return _inPreClose() || _sessionClosed(c.oracle) ? c.softLtvClosed : c.softLtvOpen;
    }

    function positionLtv(Id id, address user) public view returns (uint256) {
        Position memory p = MORPHO.position(id, user);
        if (p.borrowShares == 0) return 0;
        MarketParams memory mp = MORPHO.idToMarketParams(id);
        uint256 debt = MORPHO.expectedBorrowAssets(mp, user);
        uint256 collateralValue = Math.mulDiv(p.collateral, IOracle(mp.oracle).price(), ORACLE_PRICE_SCALE);
        if (collateralValue == 0) return type(uint256).max;
        return Math.mulDiv(debt, WAD, collateralValue, Math.Rounding.Ceil);
    }

    /// execPriceE8 of zero skips the deviation check, for actions that do not swap.
    function checkOpen(Id id, address user, uint256 execPriceE8) external view {
        if (openingPaused) revert OpeningIsPaused();
        MarketConfig memory c = _config[id];
        if (!c.enabled) revert MarketNotEnabled(id);

        (uint256 priceE8,,, Session session, uint64 feedUpdatedAt, uint64 publishedAt, bool stale) =
            ISessionOracle(c.oracle).snapshot();
        if (stale) revert OracleStale(publishedAt);
        if (session != Session.Closed && block.timestamp > uint256(feedUpdatedAt) + c.maxOracleAge) {
            revert OracleStale(publishedAt);
        }

        if (execPriceE8 != 0) {
            uint256 diff = execPriceE8 > priceE8 ? execPriceE8 - priceE8 : priceE8 - execPriceE8;
            uint256 deviationBps = Math.mulDiv(diff, BPS, priceE8);
            if (deviationBps > c.maxDeviationBps) revert PriceDeviationTooHigh(deviationBps, c.maxDeviationBps);
        }

        uint256 ltv = positionLtv(id, user);
        uint256 soft = currentSoftLtv(id);
        if (ltv > soft) revert SoftLimitExceeded(ltv, soft);

        uint256 valueUsd = _positionValueUsd(id, user, c.side);
        if (valueUsd > c.maxPositionUsd) revert PositionCapExceeded(valueUsd, c.maxPositionUsd);
    }

    function setMarketConfig(Id id, MarketConfig calldata c) external onlyOwner {
        MarketParams memory mp = MORPHO.idToMarketParams(id);
        if (mp.lltv == 0 || c.oracle != mp.oracle) revert InvalidConfig();
        if (c.softLtvClosed > c.softLtvOpen || c.softLtvOpen >= mp.lltv) revert InvalidConfig();
        if (c.maxDeviationBps > BPS || ISessionOracle(c.oracle).side() != c.side) revert InvalidConfig();
        if (_config[id].oracle == address(0)) _marketIds.push(id);
        _config[id] = c;
        emit MarketConfigured(id, c);
    }

    function tightenMarket(Id id, uint64 softLtvOpen, uint64 softLtvClosed, uint128 maxPositionUsd) external {
        if (msg.sender != guardian && msg.sender != owner()) revert Unauthorized();
        MarketConfig storage c = _config[id];
        if (c.oracle == address(0)) revert InvalidConfig();
        if (softLtvOpen > c.softLtvOpen || softLtvClosed > c.softLtvClosed || maxPositionUsd > c.maxPositionUsd) {
            revert NotTightening();
        }
        if (softLtvClosed > softLtvOpen) revert InvalidConfig();
        c.softLtvOpen = softLtvOpen;
        c.softLtvClosed = softLtvClosed;
        c.maxPositionUsd = maxPositionUsd;
        emit MarketConfigured(id, c);
    }

    /// The guardian may pause. Only the owner may resume.
    function setOpeningPaused(bool paused) external {
        if (msg.sender != owner() && !(paused && msg.sender == guardian)) revert Unauthorized();
        openingPaused = paused;
        emit OpeningPaused(paused);
    }

    function setNextCloseAt(uint64 ts) external {
        if (msg.sender != calendarPoster && msg.sender != owner()) revert Unauthorized();
        if (ts <= block.timestamp || ts > block.timestamp + MAX_CLOSE_HORIZON) revert InvalidCloseTime();
        nextCloseAt = ts;
        emit NextCloseSet(ts);
    }

    function setOracleAgeBounds(Id id, uint32 minOracleAge, uint32 capOracleAge) external onlyOwner {
        address oracle = _config[id].oracle;
        if (oracle == address(0) || minOracleAge > capOracleAge) revert InvalidConfig();
        if (capOracleAge > ISessionOracle(oracle).MAX_FEED_AGE()) revert InvalidConfig();
        _oracleAgeBounds[id] = OracleAgeBounds(minOracleAge, capOracleAge);
        emit OracleAgeBoundsSet(id, minOracleAge, capOracleAge);
    }

    /// The one value a single key may loosen, and only inside the bounds the owner accepted.
    function setMaxOracleAge(Id id, uint32 maxOracleAge) external {
        if (msg.sender != oracleAgePoster && msg.sender != owner()) revert Unauthorized();
        OracleAgeBounds memory b = _oracleAgeBounds[id];
        if (b.cap == 0 || maxOracleAge < b.min || maxOracleAge > b.cap) {
            revert OracleAgeOutOfBounds(maxOracleAge, b.min, b.cap);
        }
        MarketConfig storage c = _config[id];
        c.maxOracleAge = maxOracleAge;
        emit MaxOracleAgeSet(id, maxOracleAge);
        emit MarketConfigured(id, c);
    }

    function setOracleAgePoster(address oracleAgePoster_) external onlyOwner {
        oracleAgePoster = oracleAgePoster_;
        emit OracleAgePosterSet(oracleAgePoster_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    function setCalendarPoster(address calendarPoster_) external onlyOwner {
        calendarPoster = calendarPoster_;
        emit CalendarPosterSet(calendarPoster_);
    }

    function setPreCloseWindow(uint32 preCloseWindow_) external onlyOwner {
        if (preCloseWindow_ > MAX_PRE_CLOSE_WINDOW) revert InvalidConfig();
        preCloseWindow = preCloseWindow_;
        emit PreCloseWindowSet(preCloseWindow_);
    }

    function _inPreClose() private view returns (bool) {
        uint256 close = nextCloseAt;
        if (close == 0) return false;
        return block.timestamp + preCloseWindow >= close && block.timestamp < close + CLOSE_GRACE;
    }

    /// An oracle that cannot be read counts as closed, the stricter regime.
    function _sessionClosed(address oracle) private view returns (bool) {
        try ISessionOracle(oracle).snapshot() returns (
            uint256, uint256, uint256, Session session, uint64, uint64, bool
        ) {
            return session == Session.Closed || session == Session.Unknown;
        } catch {
            return true;
        }
    }

    /// Stock exposure in quote token base units: collateral value for a long, debt value for a short.
    function _positionValueUsd(Id id, address user, Side side) private view returns (uint256) {
        MarketParams memory mp = MORPHO.idToMarketParams(id);
        uint256 oraclePrice = IOracle(mp.oracle).price();
        if (side == Side.Long) {
            return Math.mulDiv(MORPHO.position(id, user).collateral, oraclePrice, ORACLE_PRICE_SCALE);
        }
        return Math.mulDiv(MORPHO.expectedBorrowAssets(mp, user), ORACLE_PRICE_SCALE, oraclePrice);
    }
}
