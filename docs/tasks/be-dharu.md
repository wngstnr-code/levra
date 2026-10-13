# Backend tasks (Dharu)

Folder: `apps/api/`, `apps/indexer/`, `apps/keeper/`, `packages/db/`, `packages/kyber/`, plus `packages/shared/api/`, `math.ts`, `gaps.ts`.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 02-architecture.md, 03-interfaces.md, 04-risk-rules.md, 05-addresses-and-services.md.

Tasks marked **(spike)** exist to prove an assumption. Write the result in the document named in the task, whatever the result is.

Three rules for the backend:

1. The backend never holds user keys and never sends transactions on behalf of a user.
2. If an outside service is down, answer with a clear error. Never give an approximate number.
3. The source of truth is the chain. The database is only a copy, to make things faster and to keep history.

---

## M0. Foundation and spikes

- [x] **BE-01 · Set up `apps/api`, `apps/indexer`, `apps/keeper`**
  - Do: the skeleton of each app; Postgres and migrations; logging; CI and type checks on GitHub Actions; `.env.example`.
  - Done when: `GET /v1/health` responds on your own machine; CI passes on GitHub.
  - Note: `apps/api` (Hono, `GET /v1/health`, shared error shape), `apps/keeper` (job runner with heartbeats in Postgres), `packages/db` (Drizzle schema and migrations, D-33), `docker-compose.yml` for local Postgres and `.github/workflows/backend.yml` are written. `/v1/health` answered on Dharu's machine on 13 October 2026. `apps/indexer` is created by the Envio scaffold in BE-06. The Backend workflow passed on GitHub on PR 7.

- [x] **BE-02 · API data shapes**
  - Do: zod schemas for all endpoints in 03, in `packages/shared/api/`, with the derived types.
  - Done when: Nabil and Wangsit have read and approved it; the status in 03 is changed to "frozen"; the frontend can import the types.
  - Note: merged as PR 2 on 13 October 2026. The API side of the interface agreement is frozen.

- [x] **BE-03 · Oracle logger (spike)**
  - Needs: Postgres from BE-01.
  - Do: a long-running process that records every price change for QQQ, HOOD and BIL in the Anchored oracle into Postgres: the price, best bid and best ask, market session, source quote time (`feedUpdateTimestamp`) and publish time (`publishedAt`), plus the block time of each read. It keeps running after the spike. Add queries for the update interval and the source quote age per session (p50, p95, p99, max), and for every session change with its time. Check whether the oracle emits an event on each update; if it does, backfill past weeks from the logs. Add a query that computes `maxOracleAge` per market with the formula in 04.
  - Done when: the data covers at least 7 days including one weekend; the report on how often the price is updated in each session, what happens at the close, the exact schedule of each session, and whether the best bid and best ask always make sense is generated from the queries, not written by hand. 04 is updated. Q-03 and Q-19 are answered. Wangsit gets the max age value. BE-17 can read the tables it needs.
  - Note: start on day one, because it needs a week. A partial report after the first day is fine if it says clearly that the weekend is not covered yet. This logger later becomes the oracle monitor (BE-50).
  - Note: done on 13 October 2026. The oracle emits `PriceUpdated` on every write, so the recorder (`apps/keeper`, job `oracleMonitor`) backfilled 29 September to 13 October from logs (4,603 writes, two weekends) and then follows new logs every 5 seconds. Report: `docs/reports/oracle-2026-10-13.md`, regenerated with `pnpm --filter @levra/keeper report:oracle`. Findings are in 04, Q-03 and Q-19 are answered, and the hard age questions went to Wangsit as Q-28. It runs on Dharu's machine until staging (BE-15). The event ABI comes from PR 8, which needs Wangsit's review.

- [x] **BE-04 · KyberSwap (spike)**
  - Do: get an identifier; try to find a route and build calldata with a contract address as the recipient; record the rate limit. Write a script that measures market depth (buy and sell $100, $300, $1,000, $3,000, $10,000 for each stock, against the DEX mid price and against the oracle), runs daily and stores the results.
  - Done when: 05 is updated with how to use it and its limits; the depth table in 05 is replaced with the new measurements using one consistent method; Wangsit uses the calldata in SC-04.
  - Note: checked by hand on 13 October 2026: routes work with any client ID, all three pools pair with USDC in one hop, and calldata builds with a contract as sender and recipient. Details in 05. Done on 13 October 2026: the keeper job `marketDepth` measures the DEX mid price of every stock every 10 minutes and the full table (buy and sell at $100 to $10,000) once a day into `dex_quotes`; `report:depth` prints it; 05 has the new table, measured in one run with one method (D-36), and what was observed about request limits (33 requests in 18 seconds, no 429; the official limit is not published). The client moved to `packages/kyber` for the API and the keeper.

- [~] **BE-05 · Real cross-chain deposit (spike)**
  - Do: get an Aurora Intents API key; send $5 from another chain to USDC on Monad; record the time and fee; try a small transfer of MON; read the documentation on running a step when the funds arrive.
  - Done when: the source and destination transaction hashes are recorded in PROGRESS.md; 05 is updated; Q-10 is answered; the material for Q-09 is handed to Wangsit.
  - Note: price-only quotes from Base, Arbitrum and Ethereum to USDC on Monad work without an API key, and so does a small quote into MON. Results in 05. Still to do: a real deposit, the API key, and the run-on-arrival feature.

- [x] **BE-06 · Indexer on Monad (spike)**
  - Do: read one type of Morpho event on chain 143 with the indexer tool of your choice.
  - Done when: that event is in the database; if the default tool does not fit, the replacement is recorded as a decision in 09.
  - Note: Envio's documentation lists Monad mainnet (chain 143) with a HyperSync endpoint. Not run yet, and whether an API token is needed is unknown.
  - Note (13 October 2026): the Envio CLI (HyperIndex) has no Windows build, so the indexer is our own (`apps/indexer`, D-34) and reads logs from Envio HyperSync through its JSON API, with the RPC endpoint as fallback. `monad.hypersync.xyz/height` answers without a token and matches the chain head; `/query` needs an API token (401 without one). Router events reach the database through the RPC source on the fork. Done on 13 October 2026: Morpho events for our markets reach `morpho_events` through the RPC source on the fork (D-34 records the replacement of HyperIndex). Not verified yet: the HyperSync path against real data, which needs the token (Dharu creates it at app.envio.dev).

---

## M1. Core long

- [x] **BE-10 · Chain reader**
  - Needs: SC-03.
  - Do: one layer for reading the oracle, the Morpho market state and positions through `Lens`, with a short cache and handling of RPC endpoint limits. Risk parameters such as `maxOracleAge` and the `stale` flag from `SessionOracle.snapshot()` are always read from the chain, never kept as constants in the backend.
  - Done when: all endpoints use it; no other part calls the RPC endpoint directly; changing `maxOracleAge` on chain changes `oracleStale` and the `ORACLE_STALE` warning without a backend deploy.
  - Note: `apps/api/src/chain/` reads `Lens.getMarkets`, `getPositions`, `RiskManager.config`, the session values and Morpho's market fee with multicall, JSON-RPC batching and a 1 to 2 second single-flight cache. A failed read answers `UPSTREAM_ERROR`. A fork test sets `maxOracleAge` through the owner and sees `oracleStale` flip without a restart. The `ORACLE_STALE` quote warning reads the same field (BE-12).

- [x] **BE-11 · Markets, market session and price stream**
  - Needs: BE-10.
  - Do: `GET /v1/markets`, `GET /v1/session`, `GET /v1/stream`.
  - Done when: the numbers match direct reads from the chain; the stream sends a new price within a few seconds of it being published on chain.
  - Note: `GET /v1/config`, `/v1/session`, `/v1/markets` and `/v1/stream` (SSE: `price` per stock, `market`, `session`, only on change, read every 2 seconds) are written. A fork test checks every market number against direct contract reads. `nextOpenAt` stays null until the calendar (BE-30). The DEX price fields come from the depth keeper (BE-04) and are null when no mid price is under 30 minutes old. Done on 13 October 2026 against the mainnet deployment: three live oracle writes reached a stream client 1 to 2 seconds after they were published on chain (HOOD 2 s, BIL 2 s, QQQ 1 s).

- [x] **BE-12 · Quote engine for long**
  - Needs: BE-04, BE-10, BE-16, the ABI from SC-03. For simulation it needs SC-14.
  - Do: `POST /v1/quote/open`, `/v1/quote/close`, `/v1/quote/collateral` for long. Compute the loan amount from the leverage; request a route; build the router calldata; simulate against the chain; fill in the gas limit; fill in warnings and the required approvals.
  - Done when: the transaction data from a quote runs successfully on the local fork for open, reduce and full close; the displayed summary matches the real result within the requested slippage tolerance.
  - Note: done on 13 October 2026 on the local fork with the live KyberSwap route (`apps/api/test/quote-long.fork.test.ts`): first use with a USDC permit and a Morpho authorization signed by a real key, sent as one `multicall`; then reduce by half, remove collateral, and full close, each from its quote. Collateral and returned USDC landed within 2% of the preview at 1% slippage, and the router held no USDC afterwards. `/v1/quote/collateral` also works for short markets; open and close for short come in BE-20. Realized PnL uses router events until the indexer (BE-13) exists. The DEX mid price comes from a 10 USDC KyberSwap probe. `/v1/quote/collateral` also takes `repay`, which calls `repayDebt` (D-32); the fork test repays 5 USDC after a fresh permit.

- [x] **BE-13 · Indexer**
  - Needs: BE-06, SC-03. Addresses from SC-14.
  - Do: read router events and Morpho events for our markets; build tables for positions, history, average entry price, and profit and loss. Handle users who use Morpho directly.
  - Done when: positions in the database match `Lens` for all test addresses; replaying the reads from the start gives the same result.
  - Note: per D-34, positions are read live from `Lens` and not copied; the database keeps the events that history, entry price and PnL need. `apps/indexer` follows the router's five events from the deployment block into `router_events` with a cursor, from HyperSync or RPC. Tests: decoding, the HyperSync page format, paging to the head, a replay from the start that gives the same rows, and a source that makes no progress. On the fork, a long opened from a quote is indexed and served. Done on 13 October 2026 after Wangsit added Morpho's events to the ABI export: the indexer also follows `SupplyCollateral`, `WithdrawCollateral`, `Borrow`, `Repay`, `Liquidate`, `Supply` and `Withdraw` for our market ids into `morpho_events`, and `morphoPositions` rebuilds collateral and borrow shares from them. Fork test: after an open and a reduction through the router, and for a position built straight on Morpho, the rebuilt position equals `Morpho.position`; a replay from the start gives the same rows. History shows liquidations and direct Morpho actions; the cost basis books a liquidation as the loss of the margin behind the seized stock.

- [x] **BE-14 · Account and history**
  - Needs: BE-10, BE-13.
  - Do: `GET /v1/accounts/:address` and `/history`.
  - Done when: a newly opened position shows up within a few seconds; profit and loss match hand calculations on three examples.
  - Note: done on 13 October 2026. Positions come from `Lens` on every request, so a new position shows at once; entry price, unrealized and realized PnL come from the indexed router events. Fork test: a long opened and then halved from quotes shows the same collateral and debt as `Lens`, an entry price within the 0.10% fee of the swap price, and a reduction whose realized PnL is the USDC returned minus half the margin. Unit tests check three hand calculations (+$30, +$10, -$20). Short positions show value and equity; their entry price and PnL come with BE-20. A position built straight on Morpho shows entry price and PnL as 0 until BE-13 reads Morpho events.

- [~] **BE-15 · Backend staging**
  - Needs: BE-11, BE-14.
  - Do: deploy the API, indexer and database on the service of your choice; choose a paid RPC endpoint provider; `GET /v1/status`.
  - Done when: Nabil uses the staging address from the deployed web app.
  - Note: `GET /v1/status` is written and tested: source quote age and stale flag per stock, health of every keeper from its heartbeat, indexer cursor against the chain head, and `APP_VERSION`. On 13 October 2026 api, indexer and keeper ran on Dharu's machine against the mainnet deployment (`contracts/deployments/monad.json`, public RPC, database `levra_staging`): the indexer picked up Wangsit's first-run transactions (5 opens and closes, seed lending) within seconds; `/v1/markets`, `/v1/session`, `/v1/status` (indexer lag 2 blocks, oracleMonitor and marketDepth healthy) and the account and history of the first-run wallet answered correctly; quotes built KyberSwap calldata for the mainnet router. Still to do: hosting and a paid RPC provider (Dharu and Nabil), so Nabil's deployed web app can point at it.

- [~] **BE-16 · Shared formulas**
  - Needs: SC-13 for comparison tests.
  - Do: `packages/shared/math.ts` with all the formulas in 04 using integers; `gaps.ts` with the price gap table. Include the "price used" rule from 04 (long: lower of price and best bid, short: higher of price and best ask) with the fallback to the price alone, checked on every read so the code does not depend on the answer to Q-19. The fallback condition must match `SessionOracle` exactly, as written in 04.
  - Done when: tests compare the results with `Lens` on the local fork for long and short, including a zero and a non-sensible bid and ask; Wangsit has reviewed it.
  - Note: `math.ts` and `gaps.ts` are written with unit tests on the examples in 04 (price scale, LTV, liquidation price, distance, gap, leverage table, bonus, APY, deleverage size). Each formula follows the contract code, including rounding (`RiskManager.positionLtv`, `Lens._liqPriceE8`, `SessionOracle`). The fork test in `apps/api/test/fork.test.ts` opens a real long and short on Morpho and gets exactly the same LTV and liquidation price as `Lens`, and the same Morpho price as `SessionOracle.price()`. A zero or non-sensible bid and ask cannot be produced on a fork of the live oracle, so those cases are covered by unit tests only. Still to do: Wangsit's review.

- [~] **BE-17 · Oracle age poster (keeper)**
  - Needs: BE-03, and a bounded `maxOracleAge` setter with its own role in `RiskManager` (done by Wangsit: D-31, `setOracleAgeBounds` and `setMaxOracleAge`).
  - Do: a keeper in `apps/keeper` that computes `maxOracleAge` per market from the BE-03 tables with the formula in 04, and posts it on chain. It does nothing until the data meets the minimum in 04; until then the value set at deployment stays. It posts only when the new value differs from the chain value by more than a small step, and never outside the bounds the multisig set. Every post is logged with the input numbers. Its key is used for this role only (BE-55).
  - Done when: on the local fork, the poster sets the value from recorded data; does nothing with too little data; is rejected outside the bounds; the team gets an alert for every change (BE-50). After launch no person has to touch code, the repo or the multisig for this value to follow the data.
  - Note: written on 13 October 2026. The keeper job `oracleAgePoster` (on only when `ORACLE_AGE_POSTER_KEY` and `DEPLOYMENT_FILE` are set) checks its key is the registered poster, takes the proposal per stock from the BE-03 tables, keeps it inside the owner's bounds, skips changes under 10% and posts `setMaxOracleAge` for every market of the stock, logging the inputs. Fork tests: five markets moved on chain, a value above the cap kept at the cap, small changes and too little data left alone, a wrong key refused. Run on the real two weeks of data: QQQ 2,100 s, HOOD 2,160 s, BIL 3,060 s, which equal the values the deployment script already sets, so nothing was posted. Still to do: the team alert on every change, which comes with BE-50; until then each change is a warning in the keeper log and in its heartbeat.

---

## M2. Short and Earn

- [x] **BE-20 · Quote engine for short**
  - Needs: BE-12, SC-21.
  - Do: open and close short. On close, buy slightly more stock than the debt so it is sure to be enough, and show the remainder in the summary.
  - Done when: open, reduce and full close of a short succeed on the local fork from the quote data.
  - Note: done on 13 October 2026. `/v1/quote/open` with `side: short` borrows stock worth margin times leverage at the oracle price and sells it; `/v1/quote/close` on a short market buys back the debt plus accrual, a 0.2% buffer and the slippage room, sized from the oracle price and corrected from the real route; the leftover stock goes to the wallet and shows as `stockAmountRaw` minus `debtRepaidRaw`. Accounts and history now give shorts an entry price (average sale price) and PnL. Fork test with the live KyberSwap route: first use with signatures, a 50% reduction and a full close; the debt was repaid in full and the router kept no tokens.

- [x] **BE-21 · Earn**
  - Needs: SC-23.
  - Do: `GET /v1/earn` and `/v1/earn/:address`: interest, amount supplied, share that is borrowed, amount that can be withdrawn now, for the USDC vault and the stock markets.
  - Done when: the numbers match direct reads from the chain.
  - Note: done on 13 October 2026. Options: the USDC vault (`vault:<address>`) and one stock option per short market (`market:<marketId>`), since stock is the loan token there. Vault APY is each market's supply APY weighted by the vault's assets in it, over all its assets, less the vault fee; withdrawable is idle USDC plus, per market, the smaller of the vault's assets and the market's free liquidity. Stock positions use Morpho's supply shares with the interest since the last update booked (`expectedSupplyShares` in `math.ts`). `earnedRaw` is supplied now minus net deposits from the indexed events, and can be negative after bad debt. Vault shares received by a plain transfer count fully as earned. Fork test: a vault deposit and a stock supply match `totalAssets`, `fee`, `convertToAssets`, `maxWithdraw` and Morpho's market and position reads. MetaMorpho reads use a temporary fragment until the ABI export has MetaMorpho (request to Wangsit).

- [x] **BE-22 · Indexer for Earn**
  - Needs: BE-13, SC-23.
  - Do: vault events and supply and withdraw events in the stock markets go into the history.
  - Done when: the Earn history and the interest received show correctly for the test addresses.
  - Note: done on 13 October 2026. The indexer follows the vault's ERC-4626 `Deposit` and `Withdraw` into `vault_events`, with the share owner as user, when the deployment has `usdcVault`. Morpho `Supply` and `Withdraw` in our markets were already indexed (BE-13). History shows both as `lend` and `withdrawLend`, and `/v1/earn/:address` uses them for `earnedRaw`. viem's `erc4626Abi` names the `Deposit` owner topic `receiver`, so the indexer uses the EIP-4626 names.

- [x] **BE-23 · All stocks and market detail**
  - Needs: SC-22, BE-04.
  - Do: support aHOOD and aBIL in all endpoints; `GET /v1/markets/:symbol` with the latest market depth, interest history, and DEX-to-oracle deviation history.
  - Done when: all five markets show with the correct numbers.
  - Note: done on 13 October 2026. The `marketDepth` keeper job now also stores a rate snapshot of every market from `Lens` on each run (`market_rates`, every 10 minutes) when `DEPLOYMENT_FILE` is set. `/v1/markets/:symbol` gives both sides of the stock, the latest depth run, and 30 days of rate and deviation history at one point per hour (initial proposal). Every endpoint reads markets and tokens from the deployment, so HOOD and BIL need no special code. Fork test: the detail of every stock equals its rows in `/v1/markets`, which match the contracts for all five markets, and the keeper's snapshot equals the API's rates. DB test for the history and the depth run.

---

## M3. Market-hours protection

- [~] **BE-30 · Exchange calendar and calendar poster**
  - Needs: BE-03, SC-11.
  - Do: a close and open calendar (US exchange holidays, daylight saving changes, the Anchored session schedule); a program that writes `nextCloseAt` to `RiskManager`. The Anchored schedule is read from the session changes recorded by BE-03, never typed into the code. Until a weekend close has been observed, post the earliest possible close (the regular close on the last trading day), because an early close is safe and a late one is not. The program switches to the observed schedule by itself once the data has it.
  - Done when: `nextCloseAt` on chain is correct for the next four weeks, including one holiday; on the local fork it posts the early close with no weekend data and the observed close after a weekend is recorded, with no code change in between; if this program stops, the team gets an alert.
  - Note: BE-03 data shows the weekly close at Friday 20:00 ET, with the session flipping between `POST_MARKET` and `CLOSED` until about 20:15. The close time is the first `CLOSED` write, not the last flip.
  - Note: `packages/shared/calendar.ts` (NYSE holidays and early closes from their rules, daylight saving from the time zone, the Anchored schedule as an observed offset with the regular close as fallback) and `observedClosedStretches` in `packages/db` are written with tests.
  - Note: the `calendar` keeper job is written (13 October 2026). Every 10 minutes it takes the schedule from `observedClosedStretches` (the regular close until a weekend is in the data), computes the next close on the chain's clock and posts it with `setNextCloseAt`. A close that just passed stays on chain through the contract's grace hour; a wrong future close is corrected. It runs when `CALENDAR_POSTER_KEY` and `DEPLOYMENT_FILE` are set and checks the key is the poster. Tests: a 10-minute simulation over four weeks around Thanksgiving always holds the right close (including the Wednesday and the 13:00 Friday close); on the fork the same job posts the regular close with no weekend data and moves to the observed close (4 hours later) once a weekend is added. Still to do: posting on mainnet, which needs the calendar poster role and hosting, and the alert when the job stops (BE-50, from its heartbeat).

- [x] **BE-31 · Protector keeper**
  - Needs: SC-30, BE-20.
  - Do: watch positions that have protection switched on; take the close time from the calendar (BE-30), never from a schedule of its own; when the time comes (see the order in 04) and a position is above the soft limit, compute the deleverage size with the formula in 04, request a route, call `deleverage`. Retry on failure; log every action.
  - Done when: on the local fork, positions above the limit are reduced to the target; positions without protection are not touched.
  - Note: done on 13 October 2026. The `protector` job runs every minute and acts only in the last 30 minutes before the next close from the BE-30 calendar (04 timeline), never after it. Candidates are the latest `ProtectionSet` per user and market from the indexer (`protectedPositions`); the chain decides (`protectionEnabled`, `Lens` LTV above the current soft limit). Target: the current soft limit minus 1 point. Size: the 04 formula, for a short in dollars of USDC spent; the cost c is the keeper fee plus 1% slippage plus the price impact, guessed first and then taken from the real route, plus a 0.1% margin so rounding cannot leave the position just above the target (initial proposals). A trade too far from the oracle is skipped, as the router would reject it. A failed position is logged, the run reports the error in its heartbeat, and the next run retries. Runs when `PROTECTOR_KEY` (a router keeper) and `DEPLOYMENT_FILE` are set. Fork test with live KyberSwap routes: a protected long and a protected short were reduced to just below the target; a position whose protection was switched off was not touched; the router kept no tokens. On mainnet it needs the router keeper address (blocker on Wangsit's list).

- [x] **BE-32 · Liquidator bot**
  - Needs: SC-32.
  - Do: watch all positions in our markets, including those of people who use Morpho directly; call `Liquidator` when a position passes the hard limit.
  - Done when: on the local fork, a position made unhealthy is liquidated within a few blocks.
  - Note: done on 13 October 2026. The keeper job `liquidator` (on only when `LIQUIDATOR_KEY` and `DEPLOYMENT_FILE` are set) takes every borrower in our markets from the indexed Morpho events, so users who borrow straight on Morpho are watched too, and checks health on chain with Morpho's own rounding (`morphoIsHealthy` in `math.ts`). It seizes as much as repays the whole debt (all the collateral when there is bad debt), sells the stock for a long or buys the stock back with part of the USDC for a short through KyberSwap, and halves the seizure when the DEX cannot cover the debt. It never lets the contract cover a shortfall from its own balance. Fork tests: a long after a 12% price drop and a short after a 25% rise were liquidated in the next run, a healthy position was left alone, and the `Liquidator` kept no tokens. Note for SC: the deployment script gives one `KEEPER` address both the router keeper role and the Liquidator keeper role; BE-55 asks for one key per role.

- [~] **BE-33 · Alerts for users**
  - Do: sign in with a wallet signature (`/v1/auth/siwe`); `GET` and `PUT /v1/alerts`; delivery channels (proposal: email and Telegram); a schedule of 24 hours, 4 hours and 1 hour before close, with the close time taken from the calendar (BE-30); alerts when the LTV passes a threshold, when auto-deleverage happens, and when liquidation happens.
  - Done when: a test address receives all three before-close alerts at the right times.
  - Note: written on 14 October 2026. API: `/v1/auth/nonce` and `/v1/auth/siwe` (D-38), `GET` and `PUT /v1/alerts`, and `POST`/`DELETE /v1/alerts/telegram` for linking a Telegram chat with a one-time code; on only when `AUTH_SECRET` and `AUTH_DOMAIN` are set. Keeper job `alerts` (every minute): before-close alerts at 24 hours, 4 hours and 1 hour from the BE-30 calendar for positions above the closed-market limit; LTV over the user's threshold, once per crossing; auto-deleverage, liquidation and arrived deposits from the indexed events. Each alert goes out once per channel (`alert_deliveries`), a failed send is retried. It also links Telegram chats from the bot's `/start <code>` messages. Fork test: a position above the closed limit got the three before-close alerts at the right stages and once each, a position below it got none, plus the LTV, deleverage and liquidation alerts. Still to do: pick the delivery services (Q-30), set `RESEND_API_KEY`, `ALERT_EMAIL_FROM` and `TELEGRAM_BOT_TOKEN`, and see one real email and one Telegram message arrive; email addresses are not verified yet.

- [~] **BE-34 · Gap scenarios**
  - Needs: BE-16.
  - Do: fill `gapScenarios` in quotes and in accounts; a periodic job that updates the gap table from the market data source and tells the team when the worst number changes.
  - Done when: the scenarios in the summary match the formula in 04; the gap table can be regenerated from a script.
  - Note: one `gapScenarios` helper in `packages/shared/gaps.ts` fills quotes and accounts for long and short, with tests against the formula in 04; `gapStatsFromBars` rebuilds a table row from daily bars. Still to do: the regeneration script with a data source, and the daily check that alerts the team (needs BE-50).

---

## M4. Cross-chain deposits

- [ ] **BE-40 · Deposit service**
  - Needs: BE-05.
  - Do: `GET /v1/deposit/tokens`, `POST /v1/deposit/quote`, `GET /v1/deposit/:id`; store every deposit; watch the status until it is completed, refunded or expired; include a MON transfer when requested.
  - Done when: real deposits from two different chains arrive and their status shows correctly; a failed deposit is refunded and recorded.

- [ ] **BE-41 · Withdraw to another chain**
  - Needs: BE-40.
  - Do: `POST /v1/withdraw/quote` from USDC on Monad to another chain.
  - Done when: one real withdrawal succeeds and is recorded.

- [ ] **BE-42 · Notification when funds arrive**
  - Needs: BE-40, BE-33.
  - Do: notify the app (through the stream) and the user (through the alert channels) when a deposit arrives.
  - Done when: the app moves to "funds arrived" without a reload.

---

## M5. Hardening

- [ ] **BE-50 · Monitoring and alerts for the team**
  - Do: every row in the "What we monitor" table in 08; alerts to the team channel. Grows out of the BE-03 logger. The "price too old" limit is computed per session from the BE-03 data, not typed in. Until a session has enough samples, use a strict default and mark the monitor as learning in `/v1/status`. The expected session schedule comes from the same source as BE-30.
  - Done when: each row has been triggered once on purpose and its alert arrived; a normal weekend with no updates raises no alert once the weekend is in the data.
  - Note: the Friday 20:00 to 20:15 ET session flipping seen in BE-03 is normal for this oracle and must not raise a "session outside schedule" alert.

- [ ] **BE-51 · Rate limits and abuse protection**
  - Done when: limits per IP address and per wallet work; the quote endpoints cannot be used to use up the quota of outside services.

- [ ] **BE-52 · Region and terms acceptance**
  - Needs: X-10, X-11.
  - Do: `GET /v1/eligibility` based on region; `POST /v1/terms/accept` with a wallet signature; the quote endpoints reject anyone who has not met the requirements.
  - Done when: requests from a restricted region are rejected with `REGION_BLOCKED`; the acceptance is stored together with the version of the terms.

- [ ] **BE-53 · Backups and incident runbook**
  - Do: regular database backups and a restore test; a runbook for the six situations in 07, stored in `docs/`.
  - Done when: a restore from backup has been tried; the runbook has been read by all three of us and practiced once.

- [ ] **BE-54 · Load test**
  - Done when: the quote and account endpoints hold up at the target load without passing the limits of the RPC endpoint and outside services; the result is recorded.

- [ ] **BE-55 · Keeper key management**
  - Needs: SC-55.
  - Do: one key per role (calendar poster, oracle age poster, protector, liquidator); proper secret storage, never in `.env` files on servers or in logs; keepers run apart from the public API; MON top-ups with a limit; a way to rotate keys, where the multisig removes the role from the old address.
  - Done when: there are no keys in the repo or in notes; how to rotate keys is written down and has been tried, including a drill where the oracle age poster key is treated as leaked.

---

## M6. Launch

- [ ] **BE-60 · Production backend**
  - Needs: SC-60.
  - Do: a production environment separate from staging; production addresses; keepers with production keys.
  - Done when: all endpoints answer correctly against the production contracts; all keepers send a heartbeat.

- [ ] **BE-61 · Status page**
  - Done when: the public can see the state of the oracle, keepers, API and indexer.
