# 03. Interface agreement

This document is the agreement between smart contracts (SC), backend (BE), and frontend (FE). As long as everyone holds to what is in this document, all three can build at the same time without waiting for each other.

## Status and how to change

| Part | Status | Frozen by |
|---|---|---|
| Units and number format | In effect | - |
| Contract interfaces, events, errors | Frozen on 13 October 2026 | PR 1 (SC-03), merged |
| API endpoints and data shapes | Frozen on 13 October 2026 | PR 2 (BE-02), merged |
| Contents of `packages/shared` | In effect | - |

After a part is frozen, changes only go through a PR with the label `interface`, approved by everyone affected. The PR must change this document and the code together. Adding something new is allowed at any time. Changing or removing something that exists must be discussed first.

## 1. Units and number format

These rules apply in the contracts, the API, and the app. Unit mistakes are the most common source of bugs, so do not deviate.

| Item | How to write it | Example |
|---|---|---|
| Token amount | Integer in base units. In the API it is a string. Field names end in `Raw` | 100 USDC = `"100000000"` |
| Token decimals | USDC 6 on every chain. All Anchored tokens 18. All Coinbase stock tokens on Base 8. All wrapped xStocks on X Layer 18 | 1 aQQQ = `"1000000000000000000"`, 1 NVDAc = `"100000000"` |
| Stock price in dollars | Integer with 8 decimals, same as the Anchored oracle. Field names end in `E8` | $745.62 = `"74562000000"` |
| Percentages and ratios | WAD: 1e18 means 100%, same as Morpho. Field names end in `Wad` | 77% = `"770000000000000000"` |
| Price impact, fees, deviation | Basis points, integer. Field names end in `Bps` | 0.5% = `50` |
| Leverage | Multiplied by 100, integer. Field names end in `E2` | 2x = `200` |
| Dollar value | In USDC base units, 6 decimals. Field names end in `UsdRaw` | $500 = `"500000000"` |
| Time | Seconds since 1970 (unix), integer | `1791878400` |
| Address | With mixed case matching the checksum | `0xD5D9...` |
| Morpho market ID | `bytes32`, result of `keccak256(abi.encode(marketParams))` | |
| Price ID in the oracle | `bytes32`, result of `keccak256` of the uppercase symbol | `keccak256("QQQ")` |
| Stock symbol | Uppercase without the `a` prefix | `QQQ`, `HOOD`, `BIL` |

Position direction: `long` and `short` in the API, `Side.Long` and `Side.Short` in the contracts.

Market session uses the same order as the Anchored oracle: `UNKNOWN`, `PRE_MARKET`, `REGULAR`, `POST_MARKET`, `OVERNIGHT`, `CLOSED`.

## 2. Contract interfaces

Owner: Wangsit. The binding source is `contracts/src/interfaces/`. This section mirrors it. The ABIs are copied to `packages/shared/abis/` by a script.

### Shared types

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Id} from "morpho-blue/src/interfaces/IMorpho.sol"; // Morpho's own type, a bytes32

enum Side { Long, Short }

// same order as the Anchored oracle
enum Session { Unknown, PreMarket, Regular, PostMarket, Overnight, Closed }

struct Swap {
    address target;   // must be in the router allowlist
    bytes data;       // calldata from the aggregator
    uint256 minOut;   // minimum output, in the output token
}
```

### ISessionOracle

Satisfies Morpho's `IOracle`, plus read functions for us.

```solidity
interface ISessionOracle is IOracle {
    /// Inherited from Morpho's IOracle:
    /// price of 1 base unit of collateral in base units of the loan token, times 1e36.
    /// See 04-risk-rules.md for the scale formula.
    /// function price() external view returns (uint256);

    function snapshot()
        external
        view
        returns (
            uint256 priceE8,
            uint256 bidE8,
            uint256 askE8,
            Session session,
            uint64 feedUpdatedAt,   // time of the source quote
            uint64 publishedAt,
            bool stale
        );

    function priceId() external view returns (bytes32);
    function side() external view returns (Side);
    function MAX_FEED_AGE() external view returns (uint64);    // seconds, hard limit while the market is not closed
    function MAX_PUBLISH_AGE() external view returns (uint64); // seconds, hard limit while the market is closed
}
```

Two implementations sit behind it:

| | `SessionOracle` (Monad) | `ChainlinkSessionOracle` (Base, later X Layer) |
|---|---|---|
| Source | Anchored stock oracle | Chainlink style feed with 8 decimals; on Base also the Coinbase oracle registry for the pause flag |
| `priceId()` | keccak256 of the uppercase symbol | The feed address as `bytes32` (left padded) |
| `bidE8`, `askE8` | From Anchored | Always 0. The feed has no bid or ask, so the price used is the feed answer |
| `session` | From Anchored | `Closed` from Saturday 00:00 to Monday 01:00 UTC, `Unknown` while the issuer pauses the token or the registry cannot be read, otherwise `Regular`. An issuer pause moves `price()` to the closed clock; a registry that cannot be read does not (D-93), it only refuses opens. Only `Closed` and `Unknown` change any rule; `Regular` does not mean the regular US session. The app shows sessions from `calendar.ts` |
| `feedUpdatedAt`, `publishedAt` | Source quote time and publish time | Both the feed's `updatedAt` |
| `stale` | Age over the clock of the session | Age over the clock of the session, or the issuer pause |

`ChainlinkSessionOracle` also has `FEED()`, `REGISTRY()` (zero where there is none), `TOKEN()`, `MIN_PRICE_E8()`, `MAX_PRICE_E8()` and `isWeeklyClose(uint256)`. Its own errors: `FeedDecimalsNot8(uint8)`, `InvalidPriceBounds()` and `RegistryWithoutToken()`, all at deployment only.

### IRiskManager

```solidity
interface IRiskManager {
    struct MarketConfig {
        bool enabled;            // may open new positions
        Side side;
        address oracle;          // SessionOracle of this market
        uint64 softLtvOpen;      // WAD
        uint64 softLtvClosed;    // WAD
        uint32 maxDeviationBps;  // swap price compared to oracle price
        uint32 maxOracleAge;     // seconds; for opening new positions
        uint128 maxPositionUsd;  // 6 decimals; per user per market
    }

    function config(Id id) external view returns (MarketConfig memory);
    function marketIds() external view returns (Id[] memory);
    function positionLtv(Id id, address user) external view returns (uint256); // WAD
    function isClosedRegime() external view returns (bool); // closed, or already inside the pre-close window
    function currentSoftLtv(Id id) external view returns (uint256); // WAD
    function nextCloseAt() external view returns (uint64);
    function preCloseWindow() external view returns (uint32); // seconds
    function openingPaused() external view returns (bool);

    /// Called by the router after the position is built. Reverts if a limit is broken.
    function checkOpen(Id id, address user, uint256 execPriceE8) external view;

    // settings
    function setMarketConfig(Id id, MarketConfig calldata c) external; // owner (multisig + timelock); maxOracleAge <= oracle MAX_FEED_AGE and inside the bounds; maxDeviationBps <= MAX_DEVIATION_BPS (5000)
    function tightenMarket(Id id, uint64 softLtvOpen, uint64 softLtvClosed, uint128 maxPositionUsd) external; // guardian; may only tighten
    function setOpeningPaused(bool paused) external; // guardian
    function setNextCloseAt(uint64 ts) external; // calendar poster

    // oracle age poster (D-31)
    function oracleAgePoster() external view returns (address);
    function oracleAgeBounds(Id id) external view returns (uint32 minOracleAge, uint32 capOracleAge); // seconds
    function setOracleAgeBounds(Id id, uint32 minOracleAge, uint32 capOracleAge) external; // owner; cap <= oracle MAX_FEED_AGE; current maxOracleAge inside the new bounds; (0, 0) clears; batch after setMaxOracleAge through the timelock
    function setMaxOracleAge(Id id, uint32 maxOracleAge) external; // oracle age poster; inside the bounds only
}
```

### IMarginRouter

```solidity
interface IMarginRouter {
    struct OpenParams {
        Id marketId;
        uint256 margin;        // USDC from the user
        uint256 borrowAssets;  // long: USDC borrowed. short: stock borrowed
        Swap swap;             // long: USDC -> stock. short: stock -> USDC
        uint256 maxLtv;        // WAD; highest LTV the user accepts
        uint256 deadline;
    }

    struct CloseParams {
        Id marketId;
        uint256 repayShares;     // part of the debt to repay; type(uint256).max = all
        uint256 withdrawAssets;  // collateral to withdraw; type(uint256).max = all
        uint256 swapAmountIn;    // long: stock sold. short: USDC used to buy back
        Swap swap;               // long: stock -> USDC. short: USDC -> stock
        uint256 minReturn;       // minimum USDC returned to the user
        uint256 deadline;
    }

    function openLong(OpenParams calldata p) external returns (uint256 collateralAdded, uint256 ltvAfter);
    function openShort(OpenParams calldata p) external returns (uint256 debtAdded, uint256 ltvAfter);
    function closeLong(CloseParams calldata p) external returns (uint256 returned);
    function closeShort(CloseParams calldata p) external returns (uint256 returned);

    function addCollateral(Id marketId, uint256 assets) external;
    /// Pays down the caller's debt with the loan token: USDC for a long, stock for a short (D-32).
    function repayDebt(Id marketId, uint256 assets) external returns (uint256 repaid);
    function removeCollateral(Id marketId, uint256 assets) external; // checked against the soft limit

    // automatic protection
    function setProtection(Id marketId, bool enabled) external;
    function protectionEnabled(address user, Id marketId) external view returns (bool);
    function deleverage(address user, CloseParams calldata p) external; // keeper

    // for one confirmation on first use
    function multicall(bytes[] calldata data) external returns (bytes[] memory);
    function permitToken(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
    function authorizeWithSig(
        address authorizer, bool isAuthorized, uint256 nonce, uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external; // forwards to Morpho.setAuthorizationWithSig

    // read
    function feeBps() external view returns (uint256);
    function keeperFeeBps() external view returns (uint256);
    function isSwapTarget(address target) external view returns (bool);
}
```

Rules the router must hold to:

- All user functions act on behalf of `msg.sender` only. Only `deleverage` acts on behalf of someone else, and only under the three conditions in 02-architecture.md.
- `Swap.target` must be in the allowlist. Morpho, tokens, and the router itself must not be in that list.
- No tokens are left in the router after a transaction finishes.
- Closing, reducing, and adding collateral cannot be stopped by anyone.

### ILens

```solidity
interface ILens {
    struct MarketView {
        Id marketId;
        Side side;
        bytes32 priceId;
        address collateralToken;
        address loanToken;
        uint256 lltv;            // WAD, hard limit
        uint256 softLtvOpen;     // WAD
        uint256 softLtvClosed;   // WAD
        uint256 currentSoftLtv;  // WAD
        uint256 totalSupplyAssets;
        uint256 totalBorrowAssets;
        uint256 borrowRatePerSecond; // WAD
        uint256 priceE8;
        Session session;
        uint64 feedUpdatedAt;
        uint64 publishedAt;
        bool stale;
        bool enabled;
        uint256 maxPositionUsd;
    }

    struct PositionView {
        Id marketId;
        Side side;
        uint256 collateral;   // base units of the collateral token
        uint256 debt;         // base units of the loan token, including accrued interest
        uint256 ltv;          // WAD
        uint256 softLtv;      // WAD, current
        uint256 lltv;         // WAD
        uint256 liqPriceE8;   // stock price at liquidation
        bool protection;
    }

    function getMarkets() external view returns (MarketView[] memory);
    function getPositions(address user) external view returns (PositionView[] memory);
}
```

### ILiquidator

Used by the liquidator bot only. Added after the freeze (see the interface changes in PROGRESS.md).

```solidity
interface ILiquidator {
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

    event Liquidated(
        Id indexed marketId, address indexed borrower,
        uint256 seizedAssets, uint256 repaidAssets,
        int256 loanTokenDelta, uint256 collateralLeft, address keeper
    );
}
```

For a long market the keeper sells all the seized stock (`swapAmountIn = seizedAssets`) and the gain arrives as USDC. For a short market the seized collateral is USDC: the keeper spends part of it to buy back stock, and the rest is the gain. Gains go to the treasury.

### Events

The backend reads these events. Names and field order must not change after the freeze.

```solidity
event PositionOpened(
    address indexed user, Id indexed marketId, Side side,
    uint256 margin, uint256 collateralDelta, uint256 debtDelta,
    uint256 execPriceE8, uint256 oraclePriceE8, uint256 fee, uint256 ltvAfter
);

// reason: 0 = user, 1 = automatic protection
event PositionReduced(
    address indexed user, Id indexed marketId, Side side,
    uint256 collateralDelta, uint256 debtDelta, uint256 returned,
    uint256 execPriceE8, uint256 oraclePriceE8, uint256 fee, uint256 ltvAfter,
    uint8 reason, address caller
);
// oraclePriceE8 is 0 when the oracle cannot be read during a close (SC-86). Readers must not divide by it.

event CollateralAdded(address indexed user, Id indexed marketId, uint256 assets);
event CollateralRemoved(address indexed user, Id indexed marketId, uint256 assets);
event ProtectionSet(address indexed user, Id indexed marketId, bool enabled);
event DebtRepaid(address indexed user, Id indexed marketId, uint256 assets);

// RiskManager
event MarketConfigured(Id indexed marketId, IRiskManager.MarketConfig config);
event NextCloseSet(uint64 nextCloseAt);
event OpeningPaused(bool paused);
event OracleAgeBoundsSet(Id indexed marketId, uint32 minOracleAge, uint32 capOracleAge);
event MaxOracleAgeSet(Id indexed marketId, uint32 maxOracleAge);
```

The backend also reads Morpho events for our markets, because people can use Morpho directly without going through the router: `SupplyCollateral`, `WithdrawCollateral`, `Borrow`, `Repay`, `Liquidate`, `Supply`, `Withdraw`, `AccrueInterest`.

### Errors

Errors are declared inside the interface of the contract that raises them, so each exported ABI can decode its own errors.

```solidity
// IMarginRouter
error DeadlineExpired();
error SwapTargetNotAllowed(address target);
error InsufficientSwapOutput(uint256 out, uint256 minOut);
error UserLimitExceeded(uint256 ltv, uint256 maxLtv);
error ProtectionNotEnabled(address user, Id marketId);
error PositionHealthy(uint256 ltv, uint256 softLtv);
error InsufficientReturn(uint256 returned, uint256 minReturn);
error NotMorpho();
error Unauthorized();

// IRiskManager
error MarketNotEnabled(Id marketId);
error OpeningIsPaused();
error PriceDeviationTooHigh(uint256 deviationBps, uint256 maxBps);
error OracleStale(uint64 publishedAt);
error SoftLimitExceeded(uint256 ltv, uint256 softLtv);
error PositionCapExceeded(uint256 valueUsd, uint256 capUsd);
error OracleAgeOutOfBounds(uint32 maxOracleAge, uint32 minOracleAge, uint32 capOracleAge);
error Unauthorized();

// MarginRouter, keeper reductions (D-90)
error LtvNotReduced(uint256 ltvAfter, uint256 ltvBefore);
error DeleverageTooDeep(uint256 ltvAfter, uint256 floor);   // floor = soft limit minus DELEVERAGE_FLOOR (0.05e18); a reduction to zero debt also reverts here
error DeleverageTooLarge(uint256 removedValue, uint256 allowed); // collateral value out (at the Morpho price) vs repay / (1 - deviation - keeper fee - DELEVERAGE_SLACK_BPS), D-92
error MarketClosed(); // deleverage while the oracle session is Closed (04: no auto-deleverage after the close), D-93

// Liquidator (D-91 to D-93): lossBudgetOf(token) is what the float may still lose across all liquidations.
// Each loss spends it (event LossBudgetSpent(token indexed, loss, remaining)). Only the owner changes it:
// addLossBudget(token, amount) adds to the budget as it is when the call runs, clearLossBudget(token) sets 0
// (event LossBudgetSet(token indexed, budget)). Zero by default. liquidate reverts InvalidParams on a market
// whose loan and collateral token are the same.
error LossTooLarge(int256 loanTokenDelta, uint256 budget);

// ISessionOracle
error OracleStale(uint64 publishedAt);
error InvalidOraclePrice();
```

A router call can revert with a `RiskManager` error, so the frontend decodes with both ABIs.

The frontend turns each error into a sentence the user can understand. The list of translations is in `apps/web`, keyed by the error names above.

## 3. Approvals needed from the user

| Action | Approval | Once or every time |
|---|---|---|
| Open long, open short, add collateral | USDC approval for the router (`approve` or a `permit` signature) | Once if the amount is large, or every time if exact |
| All actions through the router | `Morpho.setAuthorization(router, true)` or its signature | Once |
| Lend USDC | USDC approval for the vault | Same as above |
| Lend stock | Stock token approval for Morpho | Same as above |

Lending does not go through the router (D-07). The frontend calls the vault (`deposit`, `redeem` as in ERC-4626) and Morpho (`supply`, `withdraw`) directly.

First use is one confirmation (D-20), and the backend builds every transaction (D-19):

1. The frontend requests a quote. Unmet requirements come back with `typedData` to sign.
2. The user signs them. Signatures cost no gas.
3. The frontend requests the quote again with `signatures`. The backend returns a `tx` that is a `multicall`: apply the permit, apply the Morpho authorization, then open the position. Its `gasLimit` comes from simulating the whole `multicall`.
4. The user confirms that one transaction.

After first use, the plain quote already returns a ready `tx`.

Whether USDC on Monad supports `permit` is not verified (SC-05). If it does not, first use takes two confirmations, or uses the wallet's transaction batching feature. This path needs a normal key wallet. Privy embedded wallets are expected to be that type, to be confirmed in FE-02.

## 4. Backend API

Owner: Dharu. The binding data shape is the zod schema in `packages/shared/api/`. The text below is the explanation.

Base path: `/v1`. All responses are JSON. Errors always have this shape:

```ts
type ApiError = { error: { code: string; message: string; details?: unknown } };
```

Rate limits (BE-51, initial proposals): 429 `RATE_LIMITED` with a `Retry-After` header and `details.retryAfterSeconds`, per IP address and per wallet; quotes (trade, deposit, withdrawal) have tighter limits, and a quote can also be refused when the shared KyberSwap budget is spent.

Error codes: `BAD_REQUEST`, `NOT_FOUND`, `REGION_BLOCKED`, `TERMS_NOT_ACCEPTED`, `UNAUTHORIZED`, `RATE_LIMITED`, `NO_ROUTE`, `INSUFFICIENT_LIQUIDITY`, `QUOTE_EXPIRED`, `UPSTREAM_ERROR`, `INTERNAL`.

### The chain in the path (BE-70)

Status: proposed by Dharu on 20 November 2026 and built the same day as additions (06 lets additions go first), waiting for Nabil's review. Nothing existing changed shape, so the web app keeps working unchanged. Base and X Layer answer only once their deployment files are loaded (SC-76, SC-83); until then `live` is false.

- Routes that depend on a chain take its ID as the first path part: `/v1/:chainId/...`, with `chainId` one of `143` (Monad), `8453` (Base) and `196` (X Layer), the IDs in `chains.ts` and the ones wagmi reports. The shapes inside are the same on every chain.
- An ID outside that list answers 404 `NOT_FOUND`. A listed chain that this API does not serve yet (no deployment loaded, for example Base before SC-76) answers 404 `NOT_FOUND` with `details: { chainId, live: false }`, so the error code list stays the same. `GET /v1/chains` tells the web app which chains are live.
- The routes without a chain ID stay as they are and serve Monad (143). They are aliases until the web app has moved (FE-70); removing them is a separate change, agreed first.
- Chain routes: `config`, `session`, `markets`, `markets/:symbol`, `markets/:symbol/prices`, `stream`, `quote/open`, `quote/close`, `quote/collateral`, `accounts/:address`, `accounts/:address/history`, `earn`, `earn/:address`, `stats`, `bridge/chains`, `bridge/deposit`, `bridge/withdraw` (BE-85), `agent/prepare` (BE-77), and later `proofs`. The list is `chainRoutes` in `packages/shared/api/chains.ts`.
- Quotes (`quote/*`) on a chain answer only when the API has a swap provider for it: Monad now, Base with BE-72. Before that they answer 404 `NOT_FOUND`. The region and terms gate applies on every chain.
- Global routes, no chain ID: `health`, `status`, `/status`, `chains`, `prepared/:id` (BE-77), `eligibility`, `terms/accept`, `auth/nonce`, `auth/siwe`, `alerts`, `alerts/telegram`, `deposit/tokens`, `deposit/quote`, `withdraw/quote`, `deposit/:id`. Terms, sign-in and alert settings belong to the wallet on every chain. Deposits and withdrawals go to and from Monad only until BE-76 (after the submissions); then the two quotes move under the chain path.
- Sign-in: the SIWE message may name any chain this API serves (`live` in `/v1/chains`), the chain the wallet is on. The signature is checked on that chain, so a smart wallet deployed only there still signs in. The token is the same for every chain.
- `Market` gains three fields for the Base and X Layer stocks: `oracleKind`, `uiMultiplierWad` and `tokenPaused` (main data shapes). On Chainlink chains `oracleFeedUpdatedAt` and `oraclePublishedAt` are both the feed round's `updatedAt` (D-97), and `session` comes from our oracle's market clock, so a feed held over the weekend shows as `CLOSED` or `UNKNOWN`, not as a new field.
- Short capacity on Base (FE-72) is the existing `availableLiquidityRaw` of the short market.
- `Market.haltReasons` (BE-75) comes from the team monitor's issuer checks, which run every minute; it is as current as the monitor's heartbeat in `/v1/status`. `tokenPaused` stays the direct chain read of the token's own pause flag.

```ts
type ChainInfo = {
  chainId: number;            // 143, 8453, 196
  slug: "monad" | "base" | "xlayer";
  name: string;               // "Monad"
  nativeSymbol: string;       // gas token: "MON", "ETH", "OKB"
  live: boolean;              // this API serves its chain routes
};
type ChainsResponse = { chains: ChainInfo[]; defaultChainId: number }; // 143 (D-75)
```

### Endpoint list

Every chain route (list above) also exists as `/v1/:chainId/<path>` (BE-70); the path in this table is its Monad alias.

| Method | Path | Content | Milestone |
|---|---|---|---|
| GET | `/v1/health` | Alive or not | M1 |
| GET | `/v1/chains` | The chains this API knows and which are live (BE-70) | M7 |
| GET | `/v1/config` | Chain ID and the addresses of our contracts and markets | M1 |
| GET | `/v1/status` | Oracle age, keeper heartbeat, last indexer block; per chain in `chains` (BE-95) | M1 |
| GET | `/status` | Public status page: the same facts as one HTML page that refreshes every 30 seconds (BE-61). Not part of the versioned API | M6 |
| GET | `/v1/session` | Market session, next close and open time | M1 |
| GET | `/v1/markets` | All markets, with the current session | M1 |
| GET | `/v1/markets/:symbol` | One stock: details, depth, history of rates and price deviation | M2 |
| GET | `/v1/markets/:symbol/prices?range=1D\|1W\|1M` | Oracle price history of one stock, for charts | M2 |
| GET | `/v1/stream` | Stream of prices and market session (SSE) | M1 |
| POST | `/v1/quote/open` | Quote to open long or short | M1 long, M2 short |
| POST | `/v1/quote/close` | Quote to reduce or close | M1 long, M2 short |
| POST | `/v1/quote/collateral` | Quote to add or remove collateral | M1 |
| GET | `/v1/accounts/:address` | Positions and account summary | M1 |
| GET | `/v1/accounts/:address/history` | History of actions and profit and loss | M1 |
| GET | `/v1/earn` | Earn options: rate, amount lent, part borrowed | M2 |
| GET | `/v1/earn/:address` | Earn positions of one user | M2 |
| GET | `/v1/stats` | Public numbers of the chain: wallets, open interest, volume, Earn supplied (BE-79). Needs the database | M2 |
| POST | `/v1/agent/prepare` | Store an action an AI agent prepared, after quoting it once; returns the app link (BE-77). Agents use the chain path | M7 |
| GET | `/v1/prepared/:id` | A prepared action, for the app to quote again and sign (BE-77) | M7 |
| GET | `/v1/deposit/tokens` | Supported origin networks and tokens | M4 |
| POST | `/v1/deposit/quote` | Cross-chain deposit quote and its deposit address | M4 |
| GET | `/v1/deposit/:id` | Deposit status | M4 |
| POST | `/v1/withdraw/quote` | Quote to withdraw to another network | M4 |
| GET | `/v1/:chainId/bridge/chains` | Chains USDC can come from and go to through CCTP (BE-85) | M7 |
| POST | `/v1/:chainId/bridge/deposit` | Calls to sign on another chain that bring USDC here through CCTP (BE-85) | M7 |
| POST | `/v1/:chainId/bridge/withdraw` | Calls to sign here that send USDC to another chain through CCTP (BE-85) | M7 |
| GET | `/v1/bridge/status` | Where one CCTP burn is, by source chain and transaction hash (BE-85) | M7 |
| GET | `/v1/eligibility` | Allowed to use or not, based on region. Query: `address` (optional, adds `termsAccepted`), `chainId` (optional, adds that chain's own country list, D-73) | M5 |
| POST | `/v1/terms/accept` | Records acceptance of the terms, with a wallet signature | M5 |
| GET | `/v1/auth/nonce` | One-time nonce for the sign-in message | M3 |
| POST | `/v1/auth/siwe` | Sign in with a wallet signature, for settings | M3 |
| GET, PUT | `/v1/alerts` | User alert settings (sign-in required) | M3 |
| POST | `/v1/alerts/telegram` | One-time t.me link that links a Telegram chat to the wallet (sign-in required) | M3 |
| DELETE | `/v1/alerts/telegram` | Unlinks the Telegram chat (sign-in required) | M3 |
| GET, PUT, DELETE | `/v1/receipts/key` | The wallet's TapeSend receipt key, a public key only (sign-in required, BE-84) | M7 |
| GET | `/v1/receipts` | The wallet's sent TapeSend receipts and alerts, sealed, newest first, at most 50 (sign-in required, BE-84) | M7 |

### Main data shapes

```ts
type Address = `0x${string}`;
type Hex = `0x${string}`;
type SessionName = "UNKNOWN" | "PRE_MARKET" | "REGULAR" | "POST_MARKET" | "OVERNIGHT" | "CLOSED";
type SideName = "long" | "short";

type SessionInfo = {
  session: SessionName;
  closedRegime: boolean;      // closed, or already inside the pre-close window
  nextCloseAt: number | null; // next weekend or holiday close
  nextOpenAt: number | null;
  updatedAt: number;
  clock?: ClockCheck | null;  // X Layer, GET /v1/196/session only: the Wall Street Clock circuit (BE-86)
};

type Market = {
  symbol: string;             // "QQQ"
  name: string;               // "Invesco QQQ Trust"
  stockToken: Address;
  side: SideName;
  marketId: Hex;
  collateralToken: Address;
  loanToken: Address;
  enabled: boolean;

  oraclePriceE8: string;
  oracleFeedUpdatedAt: number; // time of the source quote
  oraclePublishedAt: number;
  oracleStale: boolean;       // SessionOracle's hard check, or older than maxOracleAge outside CLOSED (opening is refused)
  dexMidPriceE8: string | null; // DEX mid price (D-36) from the depth keeper; null when no measurement is under 30 minutes old
  dexDeviationBps: number | null; // DEX price compared to oracle; can be negative

  lltvWad: string;
  softLtvOpenWad: string;
  softLtvClosedWad: string;
  currentSoftLtvWad: string;
  maxLeverageE2: number;      // at the current soft limit
  maxPositionUsdRaw: string;

  totalSupplyRaw: string;
  totalBorrowRaw: string;
  availableLiquidityRaw: string;
  utilizationWad: string;
  borrowApyWad: string;
  supplyApyWad: string;

  // BE-70: always sent; optional in the zod schema until the web app reads them (FE-70)
  oracleKind?: "anchored" | "chainlink"; // Anchored on Monad, Chainlink on Base and X Layer
  uiMultiplierWad?: string | null; // B20 stock tokens on Base: the token's uiMultiplier() (1e18 = 1, dividends raise it); share units shown to users = raw amount x this; null where the token has none
  tokenPaused?: boolean;      // the issuer paused the stock token; false where the chain has no pause flag
  // BE-75: always sent (empty without a database); optional in the zod schema until the web app reads it
  haltReasons?: string[];     // issuer controls the team monitor sees blocking this market now, one plain sentence each: a pause of this stock, or a pause or blocklist covering the chain (USDC, Morpho, our router, liquidator or vault); opening, closing or liquidating may fail while not empty
};

type QuoteOpenRequest = {
  user: Address;
  symbol: string;
  side: SideName;
  marginRaw: string;          // USDC
  leverageE2: number;         // stock position value divided by margin, times 100
  slippageBps: number;
  signatures?: SignatureInput[]; // second request of first use
};

type Warning = {
  code:
    | "ORACLE_STALE" | "SESSION_CLOSED" | "PRE_CLOSE_WINDOW"
    | "HIGH_DEVIATION" | "HIGH_PRICE_IMPACT" | "NEAR_SOFT_LIMIT"
    | "POSITION_CAP" | "LOW_LIQUIDITY";
  severity: "info" | "warn" | "block";
  message: string;
};

type GapScenario = {
  label: string;              // "Worst gap in 5 years"
  moveBps: number;            // -540 means down 5.4%
  ltvWad: string;             // LTV after the gap
  liquidated: boolean;
};

type Requirement = {
  type: "approve" | "morphoAuthorization";
  satisfied: boolean;
  token?: Address;
  spender?: Address;
  amountRaw?: string;
  typedData?: unknown;        // EIP-712 payload to sign, when a signature can replace a transaction
};

type SignatureInput = {
  type: "approve" | "morphoAuthorization";
  signature: Hex;
  deadline: number;
  nonce?: string;
};

type TxRequest = { to: Address; data: Hex; value: string; gasLimit: string };

type QuoteOpenResponse = {
  quoteId: string;
  expiresAt: number;
  market: Market;
  preview: {
    stockAmountRaw: string;   // stock bought (long) or borrowed (short)
    collateralRaw: string;
    debtRaw: string;
    execPriceE8: string;
    oraclePriceE8: string;
    deviationBps: number;     // swap price compared to oracle
    priceImpactBps: number;   // swap price compared to the DEX mid price (D-36, measured at most 60 s before, shared by all quotes of the stock); positive is worse for the trader
    feeRaw: string;           // USDC
    ltvAfterWad: string;
    liqPriceE8: string;
    liqDistanceBps: number;   // distance from the current oracle price to the liquidation price
    borrowApyWad: string;
    gapScenarios: GapScenario[];
    circuitGapCheck?: GapCheck | null; // X Layer only: the risk circuit after gapScenarios[0] (BE-83)
  };
  requirements: Requirement[];
  tx: TxRequest;              // direct call, when all approvals are in place
  warnings: Warning[];
};

type QuoteCloseRequest = {
  user: Address;
  marketId: Hex;
  fractionWad: string;        // 1e18 = close all
  slippageBps: number;
};

type QuoteCloseResponse = {
  quoteId: string;
  expiresAt: number;
  preview: {
    stockAmountRaw: string;   // stock sold (long) or bought back (short)
    debtRepaidRaw: string;
    collateralWithdrawnRaw: string;
    returnedRaw: string;      // USDC returned to the user
    execPriceE8: string;
    oraclePriceE8: string;
    deviationBps: number;
    priceImpactBps: number;
    feeRaw: string;
    ltvAfterWad: string;
    realizedPnlUsdRaw: string; // can be negative
  };
  requirements: Requirement[];
  tx: TxRequest;
  warnings: Warning[];
};

type Position = {
  marketId: Hex;
  symbol: string;
  side: SideName;
  stockAmountRaw: string;     // long: collateral. short: debt
  collateralRaw: string;
  debtRaw: string;
  valueUsdRaw: string;
  equityUsdRaw: string;       // collateral value minus debt
  entryPriceE8: string;       // average
  oraclePriceE8: string;
  unrealizedPnlUsdRaw: string;
  pnlBps?: number | null;     // unrealizedPnlUsdRaw / margin put in, signed bps (BE-101)
  ltvWad: string;
  softLtvWad: string;
  lltvWad: string;
  liqPriceE8: string;
  liqDistanceBps: number;
  protection: boolean;
  overSoftLimit: boolean;
  gapScenarios: GapScenario[];
  circuit?: RiskCheck | null; // X Layer only: the risk circuit's answer (BE-83)
};

type Account = {
  address: Address;
  positions: Position[];
  totals: { equityUsdRaw: string; debtUsdRaw: string; unrealizedPnlUsdRaw: string };
  walletBalances: { token: Address; symbol: string; balanceRaw: string }[];
  morphoAuthorized: boolean;
  updatedAtBlock: number;
};

type HistoryItem = {
  id: string;
  type: "open" | "reduce" | "close" | "addCollateral" | "removeCollateral" | "repayDebt" | "borrow"
      | "autoReduce" | "liquidation" | "lend" | "withdrawLend";
  marketId: Hex;
  symbol: string;
  side: SideName | null;
  txHash: Hex;
  timestamp: number;
  stockAmountRaw: string | null;
  usdAmountRaw: string | null;
  execPriceE8: string | null;
  feeRaw: string | null;
  realizedPnlUsdRaw: string | null;
};

type DepositQuoteRequest = {
  recipient: Address;         // user wallet on Monad
  originChain: string;        // as in /v1/deposit/tokens
  originToken: string;
  amountRaw: string;
  refundAddress: string;      // address on the origin network
  includeGas: boolean;        // also send a little MON, as a second small transfer (D-40)
};

type DepositQuoteResponse = {
  id: string;
  depositAddress: string;
  depositMemo: string | null;
  amountOutRaw: string;       // USDC arriving on Monad
  gasOutRaw: string | null;   // MON arriving
  // With includeGas: send amountInRaw of the same token to this second address too. One address delivers one token.
  gasDeposit: { id: string; depositAddress: string; depositMemo: string | null; amountInRaw: string } | null;
  estimatedSeconds: number;
  expiresAt: number;          // when the service stops waiting for the deposit
};

type DepositStatus = {
  id: string;
  status: "WAITING" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "EXPIRED";
  originTxHash: string | null;
  destinationTxHash: string | null; // not always an EVM hash for a withdrawal
  amountOutRaw: string | null;
  updatedAt: number;          // when the status last changed
};
// Transfers go through Aurora Intents 1Click with 1% slippage; the gas top-up is worth about $1 (initial proposals).
// `/v1/deposit/:id` also serves withdrawals and the gas transfer. The service is asked at most every 10 seconds per
// transfer, and a keeper (`transfers`) follows open transfers even when nobody has the app open. EXPIRED means the
// service's deadline passed with nothing deposited.
```

### Deposits and withdrawals through CCTP (BE-85, D-54)

Status: proposed by Dharu on 24 November 2026 and built the same day as additions (06), waiting for Nabil's review. Nothing existing changed: the 1Click routes above stay on Monad until BE-76 retires them.

- `GET /v1/:chainId/bridge/chains`, `POST /v1/:chainId/bridge/deposit`, `POST /v1/:chainId/bridge/withdraw` on every live chain, and `GET /v1/bridge/status` without a chain ID.
- The API answers with the calls only. The wallet signs them on the source chain: `approve` (skip it when the USDC allowance for `approve.spender` already covers `amountRaw`), then `burn`. Before signing, the web app switches the wallet to `fromChainId`.
- The burn carries Circle's Forwarding Service hook, so Circle mints on the destination and the user needs no gas there. No Levra contract or key is involved and no funds pass through us.
- Fees come out of the amount: up to `maxFeeRaw` (Circle's Fast Transfer percentage, with a 20% margin, plus the forwarding fee, about 0.05 USDC on 24 November 2026). Fast Transfer where the source has it; elsewhere Circle's standard transfer is already fast. Smallest transfer 1 USDC. All initial proposals.
- Polling `bridge/status` with the burn's hash: `NOT_FOUND` until Circle sees the burn, then `ATTESTING`, `MINTING`, `COMPLETE` (with `mintTxHash` on the destination). On `FAILED` the web app offers `manualMint`, a call any wallet can send on the destination chain that still mints to the recipient. Answers are reused for 5 seconds.
- Region and terms apply to a deposit's `recipient` on the chain in the path, as for 1Click. A withdrawal is never gated.
- `bridge/deposit` and `bridge/withdraw` count as quotes for the rate limit, per wallet through `user` or `recipient`. Since BE-85 every limit counts a path with a chain ID like its Monad alias.

```ts
type BridgeChain = { chainId: number; name: string; domain: number; usdc: Address; fast: boolean };
type BridgeChainsResponse = { chains: BridgeChain[] };   // every CCTP chain except the one in the path
type BridgeDepositRequest = { fromChainId: number; amountRaw: string; recipient: Address };
type BridgeWithdrawRequest = { toChainId: number; amountRaw: string; user: Address; recipient: Address };
type Call = { to: Address; data: Hex };
type BridgePlan = {
  fromChainId: number;
  toChainId: number;
  amountRaw: string;          // USDC burned on fromChainId
  maxFeeRaw: string;          // the most Circle can take, out of amountRaw
  minReceivedRaw: string;     // amountRaw - maxFeeRaw
  finality: "fast" | "standard";
  estimatedSeconds: number;   // 60, not measured yet
  approve: Call & { token: Address; spender: Address };
  burn: Call;
};
// GET /v1/bridge/status?fromChainId=8453&txHash=0x...
type BridgeStatusResponse = {
  state: "NOT_FOUND" | "ATTESTING" | "MINTING" | "COMPLETE" | "FAILED";
  fromChainId: number;
  toChainId: number | null;
  txHash: Hex;
  amountRaw: string | null;
  feeRaw: string | null;      // what Circle took
  receivedRaw: string | null; // on COMPLETE
  mintTxHash: Hex | null;
  delayReason: string | null; // Circle's words, for example "insufficient_fee"
  manualMint: Call | null;    // on FAILED
};
```

### A market without an oracle price (BE-99, D-100)

When a market's oracle cannot be read (Lens reports `oraclePriceE8` 0 because `snapshot()` reverts), `oraclePriceE8` is `"0"` everywhere it appears, and that is the flag. Clients never divide by it.

- `markets`, `markets/:symbol`, `stream`, `accounts/:address` and `earn` answer as usual. `Market.oracleStale` is true and `dexDeviationBps` is null.
- `Position`: `valueUsdRaw`, `equityUsdRaw` and `unrealizedPnlUsdRaw` are `"0"`, `pnlBps` is null, and the position is left out of `Account.totals`. `ltvWad` is `"0"` (unknown, as Lens reports it), so `overSoftLimit` is false. The web app shows "no price" instead of these numbers.
- `quote/close` with `fractionWad` 1e18: a full close priced by the DEX alone. The swap and its `minOut` come from the route and the user's slippage, `preview.deviationBps` is 0, `preview.ltvAfterWad` is `"0"`, and a warning `ORACLE_STALE` with severity `warn` says so. Only through a router with SC-86 (Base, X Layer, and Monad after SC-87); the live Monad router refuses it.
- `quote/close` with a smaller fraction, and `quote/open`: 400 `BAD_REQUEST` with `details: { oraclePriceE8: "0" }` and a message that says why. The router would revert them.
- `quote/collateral`: adding collateral and repaying still quote, with `ltvAfterWad` `"0"` and an `info` warning `ORACLE_STALE`. Removing collateral while there is debt stays blocked (`ORACLE_STALE`, `block`), as before.

### Trade receipts through TapeSend (BE-84, D-116)

Proposal by Dharu on 25 November 2026, waiting for Nabil (the app side, FE-99) and Wangsit. Schemas in `packages/shared/api/receipts.ts`, crypto in `packages/tapeout/src/tapesend.ts` (TapeKit's TAP-10 v2 format, tested byte for byte against TapeKit's vectors).

1. The wallet signs the receipt key text (below) once with `personal_sign`. The app derives an X25519 key pair from the signature with `deriveReceiptKey` and keeps only the public key outside the browser. The same wallet always gets the same key, so a new device signs again instead of moving a key. EOA wallets only: a smart wallet's signature is not deterministic.
2. `PUT /v1/receipts/key` with `{ publicKey, keyIndex }`: `publicKey` is the 32-byte X25519 public key as `0x` hex, `keyIndex` 0 to 65535 (0 unless the user rotated). The API refuses a key that is not a valid X25519 point (400 `BAD_REQUEST`). `GET` answers `{ key: { publicKey, keyIndex } | null, sender }` and `DELETE` removes the key; with no key the wallet gets no receipts.
3. Every keeper queues a receipt for each position its chain's router closes for a wallet with a key, from when the key was registered (at most three days back). The pre-close and other alerts go the same way for wallets that also have alert settings. The X Layer keeper seals each message to the wallet's key and sends it with `send` on the TapeSend hub from the clock circuit's container to the wallet's endpoint `uint32(0) ‖ uint64(196) ‖ wallet` on X Layer, whatever chain the close was on. Levra pays the OKB.
4. `GET /v1/receipts` answers `{ sender, items: [{ id, txHash, inboxIndex, payload, sentAt }] }`. The same payload is in the hub's `Sent` event and can be read without the API (`inboxCount` and the logs to that endpoint). The app opens it with `open` (envelope `{ chainId: 196, to: wallet, from: sender.container, hub: sender.hub }`) and the secret key, then `decodeContent`.

`sender` is `{ chainId: 196, hub, container }`. The opened content is TAP-10 message content `{ v: 1, kind: "message", subject, body, ts }` plus Levra's `levra` object. `body` reads on its own in any TapeSend client. `levra` for a close is:

```json
{
  "type": "close",
  "chainId": 143,
  "marketId": "0x...",
  "symbol": "NVDA",
  "side": "long",
  "entryPriceE8": "15000000000",
  "exitPriceE8": "18000000000",
  "realizedUsdRaw": "20000000",
  "marginUsdRaw": "100000000",
  "pnlBps": 2000,
  "reason": 0,
  "txHash": "0x..."
}
```

`entryPriceE8` is `"0"` and `pnlBps` null for a position opened outside Levra. `reason` is the router's: 1 is a close by the protector. For an alert, `levra` is `{ "type": "alert", "key": "<chainId>:<alert key>" }`.

Receipt key text, lines joined by a single newline. `<wallet>` and `<hub>` checksummed, `<k>` the key index. The shared source is `receiptKeyText` in `packages/tapeout`:

```
app.levra.finance wants you to sign in with your Ethereum account:
<wallet>

Create the Levra key that opens your private trade receipts on X Layer. Anyone who obtains this signature can read your receipts. Only sign this on app.levra.finance.

URI: https://app.levra.finance
Version: 1
Chain ID: 196
Nonce: levrareceiptkey<k>
Issued At: 2026-11-25T00:00:00Z
Resources:
- levra:receipts:<wallet>
- tapesend:hub:<hub>
- levra:key-index:<k>
```

The key is HKDF-SHA256 over the 64 bytes r ‖ s of the signature (s normalized to the low half, so both forms of one signature give one key), salt `Levra/receipt-key/v1`, info the wallet's endpoint ‖ uint256 key index ‖ hub, 32 bytes, as the X25519 secret key. `deriveReceiptKey` checks first that the signature recovers to the wallet. The text is not a sign-in: its fixed nonce is never issued by `/v1/auth/nonce` (32 random hex characters, used once), so `/v1/auth/siwe` refuses it.

### TapeOut circuit answers on X Layer (BE-83, BE-86, D-117)

Proposal by Dharu on 26 November 2026, waiting for Nabil (FE-83). Added only: three optional fields, sent on `/v1/196/...` and absent on the other chains. Soft layer only (D-55): no contract and no hard limit reads a circuit, and a circuit answer never replaces the API's own numbers. Schemas in `packages/shared/api/circuits.ts`.

The circuits belong to Levra's processor on X Layer, `xlayerTapeout.processor` in `packages/shared` (`0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c`). Anyone reads one with `eval(circuitId, input)` on that contract, no wallet needed:

| `circuitId` | Circuit | Input, packed LSB first in each byte | Output bits |
|---|---|---|---|
| 1 | Wall Street Clock, 2026 to 2030 (`wallStreetClock` in `packages/tapeout/src/clock.ts`) | UTC day since 1970-01-01 (16 bits), then the UTC minute of that day (11 bits) | session (3 bits, the order of `Session` in section 2), holiday, weekend, early close |
| 2 | Risk at a 77% hard limit, soft limits 73% open and 70% closed (GOOGL, QQQ, SPY, long and short) | debt (80 bits), then collateral value (80 bits), both in loan token base units as Morpho counts them (debt rounded up, value `collateral * price() / 1e36` rounded down), then the session (3 bits) and the pre-close flag (1 bit) | healthy (at or under the hard limit), closed regime, at or under the soft limit that applies now, at or under the open soft limit, at or under the closed soft limit |
| 3 | Risk at 62.5%, soft limits 58% and 50% (NVDA, long and short) | as circuit 2 | as circuit 2 |

The API uses a risk circuit for a market only when the netlist onchain is byte for byte the circuit built from the market's limits as read on chain now (`riskCircuit` in `packages/tapeout/src/risk.ts`). After a limit change no circuit matches, and the answer is null until a new circuit is taped out.

```ts
type CircuitRef = { processor: Address; circuitId: number };

// Position.circuit: the risk circuit for the position now.
type RiskCheck = CircuitRef & {
  healthy: boolean;          // at or under the hard limit (not liquidatable)
  belowSoftLimit: boolean;   // at or under the soft limit that applies now (closed limit in the pre-close window)
  matches: boolean;          // false when the circuit and math.ts disagree on either answer
};

// QuoteOpenResponse.preview.circuitGapCheck: the risk circuit after the move of gapScenarios[0].
type GapCheck = CircuitRef & {
  moveBps: number;           // the same move as gapScenarios[0].moveBps
  healthyAfterGap: boolean;
  matches: boolean;
};

// SessionInfo.clock (GET /v1/196/session only): the Wall Street Clock at `updatedAt`, next to the oracle's `session`.
type ClockCheck = CircuitRef & {
  session: Session;
  holiday: boolean;
  weekend: boolean;
  earlyClose: boolean;
  matches: boolean;          // false when the circuit and calendar.ts disagree
};
```

- Each field is null on X Layer when the circuit gives no answer: no circuit holds the market's limits, the market has no oracle price, an amount does not fit in 80 bits, or the read failed or took longer than 5 seconds (initial proposal). The app then shows the API's numbers without the "checked by TapeOut circuit" mark.
- When `matches` is false the app shows the API's numbers and says the circuit disagrees; it never shows the mark.
- The gap check moves the collateral value by `moveBps` (a long's stock value moves with the price; a short's USDC buys `1 / (1 + move)` as much stock) and keeps the debt. `healthyAfterGap` is Morpho's rule (at or under the hard limit), so an LTV exactly at the hard limit counts as healthy, while `gapScenarios[0].liquidated` counts it as liquidated.
- `SessionInfo.session` stays the oracle's session, which the contracts use. `clock` is the calendar's answer from the circuit. They can differ around the weekly freeze; the app may label the market from `clock` while the oracle's price is stale.

### More data shapes

Added while writing the schemas in BE-02. The binding source for every shape is `packages/shared/api/`. `endpoints.ts` there maps each endpoint to its request and response schema.

```ts
type MarketsResponse = { session: SessionInfo; markets: Market[] };

type DepthPoint = {
  direction: "buy" | "sell";
  sizeUsdRaw: string;
  priceImpactBps: number;     // against the DEX mid price
  deviationBps: number;       // against the oracle price
  measuredAt: number;
};
type RatePoint = { marketId: Hex; timestamp: number; borrowApyWad: string; supplyApyWad: string; utilizationWad: string };
type DeviationPoint = { timestamp: number; oraclePriceE8: string; dexMidPriceE8: string; deviationBps: number };

type MarketDetail = {
  symbol: string;
  name: string;
  stockToken: Address;
  session: SessionInfo;
  markets: Market[];          // one per side
  depth: DepthPoint[];         // the latest daily depth run; failed sizes are left out
  rateHistory: RatePoint[];    // last 30 days, the last snapshot per market in each hour, oldest first
  deviationHistory: DeviationPoint[]; // last 30 days, the last mid measurement in each hour, oldest first
};
// `:symbol` is the stock symbol without the `a` prefix, any case. 404 for a stock not in the deployment.
// The three history arrays are empty when the API runs without a database. Window and bucket are initial proposals.

type PriceRange = "1D" | "1W" | "1M";
type PricePoint = { timestamp: number; oraclePriceE8: string };
type PriceHistoryResponse = {
  symbol: string;
  range: PriceRange;
  points: PricePoint[];       // oldest first
};
// GET /v1/markets/:symbol/prices?range=1D|1W|1M (BE-24, D-43). `:symbol` as above, any case.
// Source: every `PriceUpdated` write of the Anchored oracle recorded by the oracle logger (BE-03). The price is the
// oracle's own price (`price`), not the bid or ask: the same value as `Market.oraclePriceE8` and the `price` stream event.
// Points sit at multiples of the spacing in UTC: 1D every 5 minutes (288), 1W every hour (168), 1M every 4 hours (180).
// Each point is the last write at or before its time, so the price is carried forward while the oracle does not
// write (market closed), as the oracle itself does. The last point is the latest recorded price at the request time.
// Times before the first recorded write are left out, so a range can have fewer points than listed.
// Empty `points` when the API runs without a database. 400 BAD_REQUEST for a missing or unknown range,
// 404 for a stock not in the deployment. Answers are cached for 10 seconds; use the `price` stream event for live
// updates in between. Spacing, cache and ranges are initial proposals.

type QuoteCollateralRequest = {
  user: Address;
  marketId: Hex;
  action: "add" | "remove" | "repay"; // repay calls repayDebt with the loan token (D-32); amountRaw above the debt repays all of it
  amountRaw: string;
  signatures?: SignatureInput[];
};
type QuoteCollateralResponse = {
  quoteId: string;
  expiresAt: number;
  preview: { collateralAfterRaw: string; ltvAfterWad: string; liqPriceE8: string; liqDistanceBps: number };
  requirements: Requirement[];
  tx: TxRequest;
  warnings: Warning[];
};

type HistoryResponse = { items: HistoryItem[]; nextCursor: string | null }; // query: cursor, limit (1 to 100)

type EarnOption = {
  id: string;                 // "vault:<vault address>" or "market:<marketId>", lowercase
  kind: "vault" | "market";
  asset: Address;
  assetSymbol: string;
  target: Address;            // the vault, or Morpho for a market
  marketId: Hex | null;
  supplyApyWad: string;
  totalSuppliedRaw: string;
  utilizationWad: string;
  availableToWithdrawRaw: string;
  feeWad: string | null;      // share of interest taken by the vault
};
type EarnResponse = { options: EarnOption[] };
// earnedRaw: supplied now minus net deposits, signed (negative after bad debt). Stock options are the short markets.
type EarnPosition = { optionId: string; suppliedRaw: string; earnedRaw: string; withdrawableRaw: string };
type EarnAccount = { address: Address; positions: EarnPosition[] };

type DepositToken = {
  chain: string;
  chainName: string;
  token: string;
  symbol: string;
  decimals: number;
  minAmountRaw: string | null;
};
type DepositTokensResponse = { tokens: DepositToken[] };

type WithdrawQuoteRequest = {
  user: Address;
  destinationChain: string;
  destinationToken: string;
  amountRaw: string;          // USDC on Monad
  recipient: string;          // address on the destination chain
};
type WithdrawQuoteResponse = {
  id: string;
  depositAddress: Address;    // send the USDC here on Monad
  amountOutRaw: string;
  estimatedSeconds: number;
  expiresAt: number;
};

type EligibilityResponse = {
  eligible: boolean;
  reason: "REGION_BLOCKED" | null;
  termsVersion: string;
  termsAccepted: boolean | null; // null when no address was given
};
type TermsAcceptRequest = { address: Address; termsVersion: string; signature: Hex };
type TermsAcceptResponse = { accepted: true; acceptedAt: number };

type AuthNonceResponse = { nonce: string };
type SiweRequest = { message: string; signature: Hex };
type SiweResponse = { token: string; expiresAt: number };
// Sign-in (D-38): GET /v1/auth/nonce, then an EIP-4361 message with that nonce, the web app's host as domain and
// chain 143, signed by the wallet. The token goes in `Authorization: Bearer <token>` on the alert routes; 401
// UNAUTHORIZED without it. A nonce is good for 10 minutes and once; a token for 24 hours.
type TelegramLinkResponse = { url: string; expiresAt: number }; // https://t.me/<bot>?start=<code>, good for 15 minutes

type AlertSettings = {
  channels: { email: string | null; telegramLinked: boolean };
  events: {
    preClose: boolean;
    ltvThresholdWad: string | null;
    autoDeleverage: boolean;
    liquidation: boolean;
    depositArrived: boolean;
  };
};
// A wallet that never saved settings gets every event on and no channel. PUT changes only the fields it sends;
// `ltvThresholdWad` must be above 0 and below 1e18, or null to turn it off.
// When alerts go out (alerts keeper): 24 hours, 4 hours and 1 hour before a close, for positions above the closed-market
// limit; once when a position's LTV passes the threshold, again only after it went back under; on auto-deleverage,
// liquidation and an arrived deposit, for events less than a day old. An arrived deposit is a finished 1Click deposit
// or, since BE-76, any CCTP mint of USDC to the wallet on that chain (`MintAndWithdraw`, with the amount received).
// Halts (BE-75) go to every wallet with a channel, with no event switch: when an issuer control blocks a stock the user
// holds (or the whole chain, which also covers USDC lent in Earn), once per block, and once more when it is lifted. The
// text is the market's `haltReasons` sentence.

type ConfigResponse = {
  chainId: number;
  morpho: Address;
  usdc: Address;
  router: Address;
  riskManager: Address;
  lens: Address;
  markets: {
    symbol: string;
    side: SideName;
    marketId: Hex;
    oracle: Address;
    collateralToken: Address;
    loanToken: Address;
    lltv: string;
  }[];
};

type HealthResponse = { ok: true };
type StatusResponse = {
  oracle: {
    symbol: string;
    publishedAt: number;
    ageSeconds: number;
    stale: boolean;
    ageLimitSeconds?: number | null; // team monitor's "too old" limit for the current session (BE-50); null before it ran
    ageLimitLearning?: boolean;      // true while the session has too few samples and the strict default applies
  }[];
  keepers: {
    // "receipts" and "tapesend" added in BE-84. "tapesend" runs in the X Layer keeper only, so Monad's list leaves it out.
    name: "calendar" | "protector" | "liquidator" | "alerts" | "oracleMonitor" | "oracleAgePoster" | "marketDepth" | "transfers" | "monitor" | "receipts" | "tapesend";
    lastHeartbeatAt: number | null;
    healthy: boolean;
  }[];
  indexer: { lastBlock: number; chainHead: number; lagBlocks: number };
  // Added in BE-95: every chain the API has a deployment for, Monad first. The top-level keepers and indexer above stay
  // Monad's. On the other chains, keepers lists only the jobs that have reported there.
  chains?: {
    chainId: number;
    name: string;
    keepers: StatusResponse["keepers"];
    indexer: { lastBlock: number; chainHead: number; lagBlocks: number };
  }[];
  // ageSeconds is the source quote age at the latest block (D-23 clock). A keeper is healthy when its last heartbeat
  // carries no error and is at most 5 minutes old (2 hours for the hourly oracle age poster). Initial proposal.
  api: { version: string };
};
```

`GET /v1/:chainId/stats` (BE-79, D-109), schema `statsResponse` in `packages/shared/api/stats.ts`, cached for 60 seconds:

```ts
type StatsResponse = {
  chainId: number;
  wallets: { total: number; traders: number; lenders: number };
  openInterest: { longUsdRaw: string; shortUsdRaw: string; openPositions: number };
  volume: { last24hUsdRaw: string; last7dUsdRaw: string; totalUsdRaw: string; trades: number };
  earn: { suppliedUsdRaw: string };
  updatedAt: number;
};
```

- Dollar amounts are USDC base units. Stock is valued at the market's oracle price now; a market whose oracle has no price counts as 0.
- `traders`: wallets with a `PositionOpened` on any of the chain's routers. `lenders`: wallets with a vault `Deposit` or a Morpho `Supply` in our markets, without the vault itself. `total` counts a wallet once.
- `longUsdRaw`: stock collateral of the long markets, rebuilt from the indexed Morpho events. `shortUsdRaw`: `totalBorrowAssets` of the short markets read from Morpho, so interest is included. `openPositions`: Morpho positions with collateral or debt in our markets, from indexed events.
- Volume: every router `PositionOpened` and `PositionReduced` (automatic reductions included, liquidations not), the stock amount (collateral on a long, debt on a short) times the trade's `execPriceE8`. Windows end at the request time.
- `earn.suppliedUsdRaw`: the vault's assets plus the stock supplied to the short markets, as in `GET /v1/earn`.

### The `/v1/stream` stream

Server-Sent Events, one stream per chain (`/v1/:chainId/stream`, BE-70; `/v1/stream` is Monad's). Three event types:

| Event | Content | When |
|---|---|---|
| `price` | `{ symbol, oraclePriceE8, feedUpdatedAt, publishedAt, stale, dexMidPriceE8 }` | On every new price |
| `session` | `SessionInfo` | Every time the market session changes |
| `market` | `{ marketId, currentSoftLtvWad, borrowApyWad, availableLiquidityRaw }` | On every meaningful change |

### Prepared actions for AI agents (BE-77, D-111)

Status: proposed by Dharu on 24 November 2026 and built as additions (06), waiting for Nabil's review with FE-77. Nothing existing changed shape. The routes are on only when the API has a database and `WEB_APP_URL` is set.

An agent (the MCP server in `apps/agent`, or any client) prepares an action; the user opens the link in the web app, which quotes it again and asks the wallet to sign. Nobody but the user's wallet signs. The schemas are in `packages/shared/api/agent.ts`.

```ts
type PreparedAction =
  | { kind: "open"; request: Omit<QuoteOpenRequest, "signatures"> }
  | { kind: "close"; request: QuoteCloseRequest }
  | { kind: "collateral"; request: Omit<QuoteCollateralRequest, "signatures"> };

// POST /v1/:chainId/agent/prepare, body: PreparedAction
type PrepareResponse = {
  id: string;        // UUID
  url: string;       // `${WEB_APP_URL}/prepared/${id}`
  expiresAt: number; // Unix seconds: one hour after preparing (initial proposal)
  summary: string;   // one plain sentence from the quote made at preparation, for the chat
  circuitCheck?: AgentCircuitCheck | null; // X Layer only (BE-87); absent on the other chains
};

// BE-87, D-118: the TapeOut circuits' view of the action, from the quote made at preparation.
type AgentCircuitCheck = {
  risk: RiskCheck | null;   // the risk circuit on the position after the action; null after a full close
  gap: GapCheck | null;     // opens only: the quote's preview.circuitGapCheck
  clock: ClockCheck | null; // the Wall Street Clock at preparation time
};

// GET /v1/prepared/:id
type PreparedResponse = PreparedAction & {
  id: string; chainId: number; user: string; // checksummed
  summary: string; createdAt: number; expiresAt: number;
};
```

- The API stores the quote request, not a quote: a quote lives 20 seconds and a user may open the link minutes later. Before storing, the request runs once through the chain's own quote route with the caller's headers, so a request that cannot be quoted is refused with the quote's own error, and an `open` meets the same region and terms gate as `POST /v1/quote/open`.
- `GET /v1/prepared/:id` answers 404 `NOT_FOUND` for an unknown id and 409 `QUOTE_EXPIRED` after `expiresAt`. Rows are deleted a day after they expire.
- `POST /v1/:chainId/agent/prepare` counts as a quote in the rate limit, per wallet through `request.user`.
- The web app page `/prepared/:id` (FE-77, proposed): load the action, check that the connected wallet is `user` and the chain is `chainId`, send `request` to `POST /v1/:chainId/quote/<kind>` (with permit signatures as usual), show the fresh quote and that an agent prepared it, then sign. The stored `summary` is only what the agent saw; the screen shows the fresh quote.
- Prepared permits are not stored: signatures are collected in the app.
- `circuitCheck` (X Layer, BE-87). The types are in "TapeOut circuit answers on X Layer".
  - The position after the action is:
    - for an open, the quote's `collateralRaw` and `debtRaw`;
    - for a partial close, the position now less `collateralWithdrawnRaw` and `debtRepaidRaw`;
    - for a collateral action, `collateralAfterRaw` with the debt now, less `amountRaw` for a repay.
  - `risk` is null after a full close, without a position to start from, or when the circuit gives no answer.
  - The whole field is null when reading the chain fails. It never stops an action being prepared and is not stored: `GET /v1/prepared/:id` does not carry it, because the app quotes again.

The MCP server (`apps/agent`, D-111) holds no keys and no secrets. Tools: `levra_chains`, `levra_markets`, `levra_market`, `levra_account`, `levra_session`, `levra_quote_open`, `levra_quote_close`, `levra_quote_collateral` (read only; the answer has no `tx` and no `requirements`, so the agent never hands out something to sign), and `levra_prepare_open`, `levra_prepare_close`, `levra_prepare_collateral` (return the link). Remote clients use Streamable HTTP at `https://api.levra.finance/mcp` (stateless, JSON answers); local clients run it over stdio.

### Quote rules

- A quote is valid for a short time (initial proposal: 20 seconds). The frontend asks again when it is stale.
- `tx.gasLimit` comes from simulation plus a small reserve (15%). The frontend uses it as is.
- `tx.gasLimit` is `"0"` when the transaction was not simulated: a requirement is not met and no signature covers it, the user holds less than the amount the action pulls, or a warning blocks it. The frontend never sends a transaction with a gas limit of `"0"`; it asks for signatures or shows the warning, then asks again.
- If there is a warning with `severity: "block"`, `tx` is still sent but the frontend does not show the confirm button.
- On Base, `tx.data` ends with Levra's Builder Code as an ERC-8021 suffix (BE-74, D-108), already counted in `gasLimit`. The frontend sends `tx.data` unchanged and does not add a wallet `dataSuffix` on top. For the Base transactions the web app builds itself (Earn, D-07), it appends the same suffix with `withBuilderCode(chainId, data)` from `@levra/shared/api`, which leaves other chains unchanged.
- In `typedData`, every `uint256` value is a decimal string so the payload survives JSON. The frontend turns them into `bigint` before signing.
- `realizedPnlUsdRaw` in a close quote uses the margin put in through the router (from `PositionOpened` and `PositionReduced`). A position built straight on Morpho has no basis there and shows `"0"`.
- In `/v1/accounts/:address`, positions are read live from `Lens`, so they are current on every request. `entryPriceE8` and `unrealizedPnlUsdRaw` come from the same router events, and are `"0"` for positions built straight on Morpho, whose cost is not known. `pnlBps` is `unrealizedPnlUsdRaw` over the margin still in the position (the margin put in, less the share taken out by reductions), rounded toward zero, from `pnlBps` in `math.ts`; null for those positions. The API always sends it; the schema marks it optional only so older clients still type-check. History also lists liquidations and actions taken straight on Morpho (`borrow`, `lend`, `withdrawLend` and the collateral and repay types); a Morpho event in the same transaction as a router event is not listed twice.
- `/history` takes `cursor` (the `id` of the last item shown) and `limit` (1 to 100, default 20) as query parameters, newest first. An unknown cursor answers `BAD_REQUEST`.
- `maxLtv` in an open transaction is the worst-case LTV of the quote plus 1 bps of it, room for interest that accrues on existing debt before the block (initial proposal).
- Warning thresholds are initial proposals: `HIGH_PRICE_IMPACT` above 100 bps; `NEAR_SOFT_LIMIT` warns within 2 percentage points of the current soft limit and blocks above it; `HIGH_DEVIATION` warns above half of `maxDeviationBps` and blocks above it.
- The backend builds every router transaction (D-19). The frontend does not encode router calls. It decodes `tx.data` with the shared ABI and checks that the target is the router and that the arguments match what is on screen.
- The backend never holds user keys and never sends transactions on behalf of a user.

### Signed messages

Added by Nabil on 13 October 2026 with FE-50 and FE-31. Approved by Dharu on 14 October 2026 and implemented in BE-52 and BE-33.

Terms acceptance (`POST /v1/terms/accept`): the wallet signs this text with `personal_sign`, lines joined by a single newline. The API rebuilds it from `termsVersion` and `address` and checks the signature (smart wallets through ERC-1271 and ERC-6492). The shared source is `termsMessage` in `packages/shared/api/compliance.ts`, used by both the API and the web app.

Region and terms gate (BE-52): only `POST /v1/quote/open` and `POST /v1/deposit/quote` answer 403 `REGION_BLOCKED` or `TERMS_NOT_ACCEPTED` (and a prepared `open`, which runs the open quote, BE-77). Closing, reducing, collateral and withdrawals are never gated. With a block list set, a request without a country header is treated as blocked. Base and X Layer refuse more countries than Monad (D-73, D-103): an open quote is checked against the list of its chain, a deposit quote against Monad's (deposits arrive on Monad), and `POST /v1/terms/accept` against the list shared by every chain, so a visitor allowed on Monad can accept the terms and is then refused only when opening on Base or X Layer. The web app sends `chainId` to `/v1/eligibility` for the chain it shows; without it the answer covers the shared list only. Regions inside a country (ISO 3166-2, for example `UA-43`) can be blocked too when the CDN sends a region header. The routes are off when no terms version is configured.

```
Levra terms of use
Version: <termsVersion>
Address: <address, checksummed>
I confirm that I am not a resident of, or located in, a restricted region, that I read the risk disclosure, and that I accept the terms of use.
```

Sign-in for alerts (`/v1/auth/siwe`): a standard EIP-4361 message built with viem's `createSiweMessage`: `domain` is the host of the page, `uri` its origin, `chainId` one of the live chains (BE-70; 143 only before), `version` "1", the nonce from `/v1/auth/nonce`, and the statement "Sign in to Levra to manage your alerts." The API accepts the hosts in `AUTH_DOMAIN` (production, this project's Vercel previews and `localhost:3000`, BE-56) and answers CORS for the origins in `CORS_ORIGINS`, with `authorization` and `content-type` allowed. The token is sent as `Authorization: Bearer <token>`.

## 5. Contents of `packages/shared`

| File | Content | Owner | Used by |
|---|---|---|---|
| `abis/*.ts` | ABIs of our contracts (`chainlinkSessionOracleAbi` included), Morpho (functions and events), the Anchored oracle, the Chainlink feed (`chainlinkFeedAbi`) and the Coinbase oracle registry (`coinbaseOracleRegistryAbi`), the liquidator, the MetaMorpho vault (`metaMorphoAbi`, with its ERC-4626 functions and events) and ERC-2612 permit (`erc20PermitAbi`), and the reads of a TapeOut processor (`tapeoutCircuitsAbi`: `eval`, `circuitInfo`, `netlist`, `ownerOf`; no Levra contract calls it, D-66). The router, risk manager and liquidator ABIs also carry the public reads that their interfaces leave out: `isKeeper`, `feeRecipient`, `calendarPoster`, `guardian`, `owner`, `pendingOwner`, and `swapTargets()` (router and liquidator) plus `isSwapTarget` (liquidator). The router and the liquidator take one to three swap targets in the constructor, fixed forever (D-79), each with a fixed spender, the address approved for the swap amount (D-88): the target itself unless the chain config gives `swapSpenders`, as for the OKX DEX approve contract on X Layer. `swapSpender(target)` reads it (zero for an address that is not a target). The Monad deployment has one target, KyberSwap. Plain ERC-20 comes from viem | Wangsit (generated by script) | BE, FE |
| `chains.ts` | The supported chains (D-60): `chains` keyed by chain ID with `id`, `slug` (`monad`, `base`, `xlayer`), `name`, `nativeSymbol` and `explorer`; `ChainId`, `ChainSlug`, `DEFAULT_CHAIN_ID` (143, Monad, D-75), `chainIds`, `isChainId` and `chainBySlug`. X Layer (196) added in SC-80 | Wangsit | BE, FE |
| `addresses.ts` | Addresses of external services per chain: `externalByChain[chainId]` and `tokensByChain[chainId]`. Every chain has the same core keys (Morpho core, IRM, `morphoVaultV2Factory`, `morphoPublicAllocator` for Vault V2, Permit2, Multicall3, Safe, Circle's CCTP V2 `cctpTokenMessengerV2`, `cctpMessageTransmitterV2` and `cctpTokenMinterV2`) next to its own (`morphoVaultFactory` for MetaMorpho on Monad and Base only, since X Layer has none; KyberSwap and Anchored on Monad; `xStocksSanctionsList`, `wrappedOkb`, `okxDexRouter`, `okxDexApprove` and `uniswapSwapRouter02` on X Layer; the Coinbase oracle registry, the B20 policy registry and factory, `morphoMetaMorphoPublicAllocator`, `oneInchRouter`, `kyberRouter`, `aeroSwapRouter`, `aeroClFactory` and `aeroMetaQuoter` on Base, D-80). `xlayerTapeout` holds Levra's TapeOut processor on X Layer, its operator key and the circuit IDs (`wallStreetClock` 1, `risk77` 2, `risk62_5` 3; inputs and outputs in `packages/tapeout`). `external`, `tokens` and `MONAD_CHAIN_ID` stay as the Monad entries, so existing imports keep working. Our own contracts come from the deployment file | Wangsit | BE, FE |
| `markets.ts` | The stock list per chain, `stocksByChain[chainId]`: Monad stocks carry the Anchored `priceId`; Base stocks (`baseStocks`) and X Layer stocks (`xlayerStocks`, the wrapped xStocks, 18 decimals) carry the Chainlink `priceFeed`. The same symbol can exist on two chains (QQQ on Monad and X Layer). `findStock(chainId, symbol)`. `listMarkets` and `findMarket` join a deployment's markets with the stocks of the deployment's own `chainId` and throw for an unknown chain or stock. `stocks`, `StockSymbol` and `isStockSymbol` stay as the Monad entries | Wangsit | BE, FE |
| `deployments.ts` | Schema of the deployment file and `parseDeployment`, the same on every chain (section 6). `deployments.node.ts` reads the file from disk for Node. `deployments.monad.ts` exports `monadDeployment`, the mainnet file bundled for the browser. `deployments.base.ts` follows with SC-76 | Wangsit | BE, FE |
| `math.ts` | Formulas from 04: LTV, liquidation price, max leverage, gap scenarios | Dharu, reviewed by Wangsit | BE, FE |
| `gaps.ts` | Price gap table per stock | Dharu | BE, FE |
| `api/*.ts` | Zod schemas for all endpoints and the types derived from them | Dharu | BE, FE |
| `errors.ts` | List of contract error names and API error codes | Wangsit and Dharu | FE |

`math.ts` must give the same results as the contracts. A test compares it with the `Lens` results on a local mainnet fork (BE-16).

## 6. Deployment address file

Written by the deployment script to `contracts/deployments/<environment>.json`.

```json
{
  "chainId": 143,
  "block": 0,
  "router": "0x...",
  "riskManager": "0x...",
  "lens": "0x...",
  "liquidator": "0x...",
  "usdcVault": "0x...",
  "previousRouters": ["0x..."],
  "markets": [
    {
      "symbol": "QQQ",
      "side": "long",
      "marketId": "0x...",
      "oracle": "0x...",
      "collateralToken": "0x...",
      "loanToken": "0x...",
      "lltv": "770000000000000000"
    }
  ]
}
```

`previousRouters` is optional: the routers this deployment used before, oldest first, written when the router is replaced (SC-87). Their events are still part of each user's history, so the indexer reads every address in it as well as `router`. A new router does not inherit opt-in protection: users opt in again.

## 7. Environment variables

Shared names. Each app has its own `.env.example`, which lists every variable it reads. Secrets never go into the repo. On the VPS, secrets are files under `/opt/levra/secrets/<service>/` (`deploy/secrets.md`).

| Name | Used by | Content |
|---|---|---|
| `MONAD_RPC_URL` | SC, BE | Monad RPC endpoint. The indexer and keeper still read it when `CHAIN_ID` is 143 and `RPC_URL` is not set |
| `CHAIN_ID` | BE (indexer, keeper) | The chain one process serves: 143 Monad, 8453 Base, 196 X Layer (BE-95). Default 143. The deployment file must be for the same chain, or the process refuses to start |
| `RPC_URL` | BE (indexer, keeper) | RPC endpoint of `CHAIN_ID` |
| `DEPLOYMENT_FILE` | BE | `contracts/deployments/<environment>.json` of that chain. For the API, the Monad deployment the routes serve |
| `BASE_RPC_URL`, `BASE_DEPLOYMENT_FILE`, `XLAYER_RPC_URL`, `XLAYER_DEPLOYMENT_FILE` | BE (API) | Other chains the API loads when both values are set (BE-95). Only `/v1/status` reads them until the routes take a chain (BE-70) |
| `KEEPER_GLOBAL` | BE (keeper) | `1` in exactly one keeper: it also runs the jobs that serve every chain once (Telegram chat linking, the cross-chain transfer watcher, the public API check, the daily gap check). Telegram allows one update reader per bot |
| `ORACLE_BACKFILL_BLOCKS` | BE (keeper, Monad) | Blocks of Anchored oracle logs read back on the recorder's first start. Default 4,000,000 |
| `CHAINLINK_BACKFILL_DAYS` | BE (keeper, Base and X Layer) | Days of Chainlink feed rounds read back on a feed's first run (BE-97). Default 28 |
| `NEXT_PUBLIC_MONAD_RPC_URL` | FE | RPC endpoint for the browser |
| `NEXT_PUBLIC_API_URL` | FE | Backend address |
| `NEXT_PUBLIC_PRIVY_APP_ID` | FE | Privy app ID for sign-in. Public, not a secret |
| `DEPLOY_ENV` | All | `fork`, `staging`, or `production` |
| `DATABASE_URL` | BE | Postgres |
| `KYBER_CLIENT_ID` | BE | Client ID for the KyberSwap API |
| `ONEINCH_API_KEY` | BE, research scripts | 1inch Business API key for the Swap API on Base (D-80). Secret: only in a local or hosted `.env`, never in the repo |
| `INTENTS_JWT` | BE | Aurora Intents 1Click partner token. Optional: without it the service adds its own 0.2% fee to every transfer |
| `ORACLE_AGE_POSTER_KEY`, `CALENDAR_POSTER_KEY`, `PROTECTOR_KEY`, `LIQUIDATOR_KEY` | BE (keeper) | Keeper keys, one per role and chain (BE-55). Each role job runs only when its key is set |
| `TAPEOUT_KEY` | BE (keeper, X Layer) | The key that holds Levra's TapeOut circuits (BE-82). In the X Layer keeper it sends the TapeSend receipts and alerts (BE-84); unset leaves them queued |
| `DEPLOYER_PRIVATE_KEY` | SC | Deployer key, for staging only |
| `WEB_APP_URL` | BE (API) | The web app's address, for the links of prepared actions (BE-77). Unset turns the agent routes off |
| `LEVRA_API_URL` | BE (agent) | The API the MCP server calls: the internal `http://api:8787` on the server, never the public address (D-111) |
| `CLIENT_IP_HEADER` | BE (agent) | The header with the caller's address, the same value as the API's `TRUST_PROXY_HEADER`; the agent passes it on so the API rate limits each caller |

## 8. Who needs what from whom

This table shows the points where one person can be blocked by another. All of them are placed up front on purpose.

| Who needs it | Needs what | From | Through task | Meanwhile |
|---|---|---|---|---|
| Dharu, Nabil | Contract ABIs | Wangsit | SC-03 | Read data directly from the Anchored oracle and Morpho, whose ABIs are already public |
| Nabil | API data shapes | Dharu | BE-02 | Build the Markets page with data straight from the network (FE-03) |
| Dharu, Nabil | Contracts deployed on the local mainnet fork | Wangsit | SC-14 | Dharu builds the quote engine against the ABIs. Nabil builds the form and summary |
| Wangsit | Oracle price age when the market is closed | Dharu | BE-03 | Write `SessionOracle` with max age as a number set at deployment |
| Dharu | `Liquidator` contract | Wangsit | SC-32 | Build the monitor for unhealthy positions |
| Nabil | Quote endpoints | Dharu | BE-12 | Build the calldata directly from the ABIs for tests on the local mainnet fork |
| All | Staging addresses on mainnet | Wangsit | SC-15 | Work on the local mainnet fork |
