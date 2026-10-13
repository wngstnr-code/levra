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
| Token decimals | USDC 6. All Anchored tokens 18 | 1 aQQQ = `"1000000000000000000"` |
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
    function setMarketConfig(Id id, MarketConfig calldata c) external; // owner (multisig + timelock)
    function tightenMarket(Id id, uint64 softLtvOpen, uint64 softLtvClosed, uint128 maxPositionUsd) external; // guardian; may only tighten
    function setOpeningPaused(bool paused) external; // guardian
    function setNextCloseAt(uint64 ts) external; // calendar poster

    // oracle age poster (D-31)
    function oracleAgePoster() external view returns (address);
    function oracleAgeBounds(Id id) external view returns (uint32 minOracleAge, uint32 capOracleAge); // seconds
    function setOracleAgeBounds(Id id, uint32 minOracleAge, uint32 capOracleAge) external; // owner; cap <= oracle MAX_FEED_AGE
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

Error codes: `BAD_REQUEST`, `NOT_FOUND`, `REGION_BLOCKED`, `TERMS_NOT_ACCEPTED`, `UNAUTHORIZED`, `RATE_LIMITED`, `NO_ROUTE`, `INSUFFICIENT_LIQUIDITY`, `QUOTE_EXPIRED`, `UPSTREAM_ERROR`, `INTERNAL`.

### Endpoint list

| Method | Path | Content | Milestone |
|---|---|---|---|
| GET | `/v1/health` | Alive or not | M1 |
| GET | `/v1/config` | Chain ID and the addresses of our contracts and markets | M1 |
| GET | `/v1/status` | Oracle age, keeper heartbeat, last indexer block | M1 |
| GET | `/v1/session` | Market session, next close and open time | M1 |
| GET | `/v1/markets` | All markets, with the current session | M1 |
| GET | `/v1/markets/:symbol` | One stock: details, depth, history of rates and price deviation | M2 |
| GET | `/v1/stream` | Stream of prices and market session (SSE) | M1 |
| POST | `/v1/quote/open` | Quote to open long or short | M1 long, M2 short |
| POST | `/v1/quote/close` | Quote to reduce or close | M1 long, M2 short |
| POST | `/v1/quote/collateral` | Quote to add or remove collateral | M1 |
| GET | `/v1/accounts/:address` | Positions and account summary | M1 |
| GET | `/v1/accounts/:address/history` | History of actions and profit and loss | M1 |
| GET | `/v1/earn` | Earn options: rate, amount lent, part borrowed | M2 |
| GET | `/v1/earn/:address` | Earn positions of one user | M2 |
| GET | `/v1/deposit/tokens` | Supported origin networks and tokens | M4 |
| POST | `/v1/deposit/quote` | Cross-chain deposit quote and its deposit address | M4 |
| GET | `/v1/deposit/:id` | Deposit status | M4 |
| POST | `/v1/withdraw/quote` | Quote to withdraw to another network | M4 |
| GET | `/v1/eligibility` | Allowed to use or not, based on region | M5 |
| POST | `/v1/terms/accept` | Records acceptance of the terms, with a wallet signature | M5 |
| GET | `/v1/auth/nonce` | One-time nonce for the sign-in message | M3 |
| POST | `/v1/auth/siwe` | Sign in with a wallet signature, for settings | M3 |
| GET, PUT | `/v1/alerts` | User alert settings (sign-in required) | M3 |

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
    priceImpactBps: number;   // swap price compared to the DEX mid price (D-36); positive is worse for the trader
    feeRaw: string;           // USDC
    ltvAfterWad: string;
    liqPriceE8: string;
    liqDistanceBps: number;   // distance from the current oracle price to the liquidation price
    borrowApyWad: string;
    gapScenarios: GapScenario[];
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
  ltvWad: string;
  softLtvWad: string;
  lltvWad: string;
  liqPriceE8: string;
  liqDistanceBps: number;
  protection: boolean;
  overSoftLimit: boolean;
  gapScenarios: GapScenario[];
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
  includeGas: boolean;        // also send a little MON
};

type DepositQuoteResponse = {
  id: string;
  depositAddress: string;
  depositMemo: string | null;
  amountOutRaw: string;       // USDC arriving on Monad
  gasOutRaw: string | null;   // MON arriving
  estimatedSeconds: number;
  expiresAt: number;
};

type DepositStatus = {
  id: string;
  status: "WAITING" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED" | "EXPIRED";
  originTxHash: string | null;
  destinationTxHash: Hex | null;
  amountOutRaw: string | null;
  updatedAt: number;
};
```

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
  depth: DepthPoint[];
  rateHistory: RatePoint[];
  deviationHistory: DeviationPoint[];
};

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
  id: string;
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
  oracle: { symbol: string; publishedAt: number; ageSeconds: number; stale: boolean }[];
  keepers: {
    name: "calendar" | "protector" | "liquidator" | "alerts" | "oracleMonitor" | "oracleAgePoster" | "marketDepth";
    lastHeartbeatAt: number | null;
    healthy: boolean;
  }[];
  indexer: { lastBlock: number; chainHead: number; lagBlocks: number };
  // ageSeconds is the source quote age at the latest block (D-23 clock). A keeper is healthy when its last heartbeat
  // carries no error and is at most 5 minutes old (2 hours for the hourly oracle age poster). Initial proposal.
  api: { version: string };
};
```

### The `/v1/stream` stream

Server-Sent Events. Three event types:

| Event | Content | When |
|---|---|---|
| `price` | `{ symbol, oraclePriceE8, feedUpdatedAt, publishedAt, stale, dexMidPriceE8 }` | On every new price |
| `session` | `SessionInfo` | Every time the market session changes |
| `market` | `{ marketId, currentSoftLtvWad, borrowApyWad, availableLiquidityRaw }` | On every meaningful change |

### Quote rules

- A quote is valid for a short time (initial proposal: 20 seconds). The frontend asks again when it is stale.
- `tx.gasLimit` comes from simulation plus a small reserve (15%). The frontend uses it as is.
- `tx.gasLimit` is `"0"` when the transaction was not simulated: a requirement is not met and no signature covers it, the user holds less than the amount the action pulls, or a warning blocks it. The frontend never sends a transaction with a gas limit of `"0"`; it asks for signatures or shows the warning, then asks again.
- If there is a warning with `severity: "block"`, `tx` is still sent but the frontend does not show the confirm button.
- In `typedData`, every `uint256` value is a decimal string so the payload survives JSON. The frontend turns them into `bigint` before signing.
- `realizedPnlUsdRaw` in a close quote uses the margin put in through the router (from `PositionOpened` and `PositionReduced`). A position built straight on Morpho has no basis there and shows `"0"`.
- In `/v1/accounts/:address`, positions are read live from `Lens`, so they are current on every request. `entryPriceE8` and `unrealizedPnlUsdRaw` come from the same router events, and are `"0"` for short positions until the short quote engine (BE-20) and for positions built straight on Morpho, whose cost is not known. History also lists liquidations and actions taken straight on Morpho (`borrow`, `lend`, `withdrawLend` and the collateral and repay types); a Morpho event in the same transaction as a router event is not listed twice.
- `/history` takes `cursor` (the `id` of the last item shown) and `limit` (1 to 100, default 20) as query parameters, newest first. An unknown cursor answers `BAD_REQUEST`.
- Warning thresholds are initial proposals: `HIGH_PRICE_IMPACT` above 100 bps; `NEAR_SOFT_LIMIT` warns within 2 percentage points of the current soft limit and blocks above it; `HIGH_DEVIATION` warns above half of `maxDeviationBps` and blocks above it.
- The backend builds every router transaction (D-19). The frontend does not encode router calls. It decodes `tx.data` with the shared ABI and checks that the target is the router and that the arguments match what is on screen.
- The backend never holds user keys and never sends transactions on behalf of a user.

## 5. Contents of `packages/shared`

| File | Content | Owner | Used by |
|---|---|---|---|
| `abis/*.ts` | ABIs of our contracts, Morpho (functions and events), the Anchored oracle and the liquidator. ERC-20 and ERC-4626 come from viem | Wangsit (generated by script) | BE, FE |
| `addresses.ts` | Addresses of external services and our contracts per environment | Wangsit | BE, FE |
| `markets.ts` | The stock list (symbol, name, token, price ID) and helpers that join it with a deployment's markets | Wangsit | BE, FE |
| `deployments.ts` | Schema of the deployment file and `parseDeployment`. `deployments.node.ts` reads the file from disk for Node. `deployments.monad.ts` exports `monadDeployment`, the mainnet file bundled for the browser | Wangsit | BE, FE |
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

## 7. Environment variables

Shared names. Each app has its own `.env.example`. Secrets never go into the repo.

| Name | Used by | Content |
|---|---|---|
| `MONAD_RPC_URL` | SC, BE | Monad RPC endpoint |
| `NEXT_PUBLIC_MONAD_RPC_URL` | FE | RPC endpoint for the browser |
| `NEXT_PUBLIC_API_URL` | FE | Backend address |
| `NEXT_PUBLIC_PRIVY_APP_ID` | FE | Privy app ID for sign-in. Public, not a secret |
| `DEPLOY_ENV` | All | `fork`, `staging`, or `production` |
| `DATABASE_URL` | BE | Postgres |
| `KYBER_CLIENT_ID` | BE | Client ID for the KyberSwap API |
| `ONECLICK_API_KEY` | BE | Aurora Intents API key |
| `KEEPER_PRIVATE_KEY_*` | BE | Keeper keys, one per role |
| `DEPLOYER_PRIVATE_KEY` | SC | Deployer key, for staging only |

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
