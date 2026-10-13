# 10. Screens

Status: first draft for task FE-04, written from 01 and 03. Nabil owns this document and the final design. It lists what each screen needs, so the frontend can be planned and so missing data is found before more is built. It does not decide layout or visual style.

Data sources use the endpoint names in `packages/shared/api/endpoints.ts`. "Direct" means a contract call from the browser.

## Always visible

| Element | Data | Notes |
|---|---|---|
| Market session badge | `session`, or the `session` event on `stream` | Open, pre-market, after-hours, overnight, closed. Shows a countdown inside the pre-close window (`nextCloseAt`) |
| Wallet button | Wallet and Privy state | Connect, short address, disconnect, switch to Monad |
| Stale price banner | `markets` (`oracleStale`) | Shown when any listed price is stale while the market is not closed |
| Service banner | `status` | Shown when the indexer lags or a keeper is unhealthy |
| Region and terms gate | `eligibility`, `termsAccept` | Blocks the trade, Earn and deposit screens until passed |

## Screens

### Home

| | |
|---|---|
| Purpose | Say what Levra is and lead to Markets |
| Data | None |
| Actions | Go to Markets, connect |
| States | One state |

### Markets

| | |
|---|---|
| Purpose | Compare the stocks and pick one |
| Data | `markets`, then `price` and `market` events on `stream` |
| Shows per stock | Price, price age, session, DEX-to-oracle deviation, current soft limit, max leverage for long and short, borrow rate, available liquidity, position cap |
| Actions | Open a market detail, go to Trade with the stock chosen |
| States | Loading, loaded, read error with retry, market not enabled, price stale |

### Market detail

| | |
|---|---|
| Purpose | Explain one stock's market before trading it |
| Data | `marketDetail` |
| Shows | Market depth by size (price impact and deviation), deviation history, hard and soft limits with a plain explanation, rate history, price age, both sides if a short market exists |
| Actions | Go to Trade, go to Earn |
| States | Loading, loaded, error, no depth data yet |

### Trade

One screen with two tabs, Long and Short.

| | |
|---|---|
| Purpose | Open a position in one confirmation |
| Data | `markets`, `account` (USDC balance, authorization), `quoteOpen` |
| Inputs | Stock, side, margin in USDC, leverage, slippage |
| Summary before confirm | Everything in Flow 2 or Flow 3 of 01: stock amount, debt, execution price against oracle price, price impact, fee, LTV after against soft and hard limits, liquidation price and distance, borrow rate, gap scenarios |
| Actions | Sign the two first-use messages if needed, confirm one transaction, follow it to the result |
| States | Not connected, region blocked, loading quote, quote ready, quote stale (asks again), warning shown, blocked by a `block` warning (no confirm button), waiting for signature, transaction pending, success, reverted with a readable reason, insufficient balance, above position cap, not enough liquidity to borrow |

### Positions

| | |
|---|---|
| Purpose | See every position and act on it |
| Data | `account`, `accountHistory`, events on `stream` |
| Shows per position | Stock, side, size, value, debt, equity, entry price, profit and loss, LTV bar with soft and hard marks, liquidation price and distance, protection on or off, gap scenarios, a warning when above the soft limit |
| Actions | Add collateral, remove collateral (`quoteCollateral`), reduce or close (`quoteClose`), turn protection on or off (direct call to the router) |
| States | Not connected, no positions, loading, loaded, error, position above soft limit, pre-close window, transaction states as in Trade |
| History | Open, reduce, close, collateral changes, auto-deleverage and liquidation, each explained in a sentence |

### Earn

| | |
|---|---|
| Purpose | Lend USDC or stock for interest |
| Data | `earn`, `earnAccount`, `account` (wallet balances) |
| Shows per option | Asset, interest rate, total supplied, share borrowed, amount that can be withdrawn now, vault fee |
| Actions | Supply and withdraw. USDC goes to the vault and stock goes to its Morpho market, both as direct calls (D-07). Stock tokens have no `permit`, so supplying stock is an approval transaction and then a supply transaction |
| States | Not connected, loading, loaded, error, nothing to withdraw right now (fully borrowed), transaction states |
| Must show | The lender risk statement before the first supply |

### Deposit

| | |
|---|---|
| Purpose | Bring funds from another chain |
| Data | `depositTokens`, `depositQuote`, `depositStatus` |
| Inputs | Origin chain and token, amount, refund address on the origin chain, include gas or not |
| Shows | Deposit address with QR code, amount that will arrive, MON that will arrive, time estimate, expiry |
| Actions | Copy the address, then watch the status until funds arrive, then go to Trade |
| States | Choosing, quote ready, waiting for the transfer, processing, arrived, refunded, failed, expired |

### Withdraw

| | |
|---|---|
| Purpose | Send USDC to another chain |
| Data | `withdrawQuote`, `depositStatus` |
| Actions | Send USDC on Monad to the quoted address, then watch the status |
| States | As in Deposit |

### Settings

| | |
|---|---|
| Purpose | Control protection, alerts and authorization |
| Data | `account` (authorization, protection per position), `alertsGet` after sign-in with `authNonce` and `authSiwe` |
| Actions | Toggle protection per market, set alert channels and events (`alertsPut`), revoke the Morpho authorization (direct call to Morpho), export the embedded wallet if the user signed in by email or passkey |
| States | Not connected, not signed in for alerts, loaded, saving, error |

### Help

| | |
|---|---|
| Purpose | Explain the product and its risks |
| Data | Static text, plus the contract address list from `packages/shared` |
| Contains | How it works, risk disclosure, questions and answers, how to revoke authorization without the app, terms of use, privacy policy, link to the status page and the audit report |

## Data the screens need that the API does not provide yet

Found while writing this draft. Each needs a decision before the screen is built. Adding a field or endpoint is allowed after the freeze (see 03).

| Screen | Missing | Suggested fix |
|---|---|---|
| Deposit and Withdraw | A list of a user's past and pending transfers. Today a transfer can only be read by its `id` | Add `GET /v1/deposit?recipient=<address>`, or keep the ids in the browser |
| Markets and Trade | The time of the source quote. The API exposes only `oraclePublishedAt` | Depends on Q-22. If option A is chosen, add `oracleFeedUpdatedAt` |
| Positions, history | For a liquidation: the collateral taken and the bonus paid | Add two nullable fields to `HistoryItem` |
| Trade | The typed data for first-use signatures is typed as `unknown` | Fine as is. The frontend passes it to the wallet unchanged |
| Earn | Whether the user has already approved the vault or Morpho to spend the asset | Read the allowance directly from the token |
