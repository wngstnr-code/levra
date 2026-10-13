# Backend tasks (Dharu)

Folder: `apps/api/`, `apps/indexer/`, `apps/keeper/`, plus `packages/shared/api/`, `math.ts`, `gaps.ts`.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 02-architecture.md, 03-interfaces.md, 04-risk-rules.md, 05-addresses-and-services.md.

Tasks marked **(spike)** exist to prove an assumption. Write the result in the document named in the task, whatever the result is.

Three rules for the backend:

1. The backend never holds user keys and never sends transactions on behalf of a user.
2. If an outside service is down, answer with a clear error. Never give an approximate number.
3. The source of truth is the chain. The database is only a copy, to make things faster and to keep history.

---

## M0. Foundation and spikes

- [ ] **BE-01 · Set up `apps/api`, `apps/indexer`, `apps/keeper`**
  - Do: the skeleton of each app; Postgres and migrations; logging; CI and type checks on GitHub Actions; `.env.example`.
  - Done when: `GET /v1/health` responds on your own machine; CI passes on GitHub.

- [x] **BE-02 · API data shapes**
  - Do: zod schemas for all endpoints in 03, in `packages/shared/api/`, with the derived types.
  - Done when: Nabil and Wangsit have read and approved it; the status in 03 is changed to "frozen"; the frontend can import the types.
  - Note: merged as PR 2 on 13 October 2026. The API side of the interface agreement is frozen.

- [~] **BE-03 · Oracle logger (spike)**
  - Do: a small program that records every price change for QQQ, HOOD and BIL in the Anchored oracle: the price, best bid and best ask, market session, publish time. Run it for at least 7 days, and it must cover one weekend.
  - Done when: there is a short report on how often the price is updated in each market session, what happens at the close, the exact schedule of each session, and whether the best bid and best ask always make sense. 04 is updated. Q-03 and Q-19 are answered. Wangsit gets the max age value.
  - Note: Anchored's documentation answers part of this (heartbeat, delay, session hours, carry-forward while closed) and is summarized in 05 and 04. The logger itself is not written or running yet, so nothing is confirmed by observation.

- [~] **BE-04 · KyberSwap (spike)**
  - Do: get an identifier; try to find a route and build calldata with a contract address as the recipient; record the rate limit. Write a script that measures market depth (buy and sell $100, $300, $1,000, $3,000, $10,000 for each stock, against the DEX mid price and against the oracle), runs daily and stores the results.
  - Done when: 05 is updated with how to use it and its limits; the depth table in 05 is replaced with the new measurements using one consistent method; Wangsit uses the calldata in SC-04.
  - Note: checked by hand on 13 October 2026: routes work with any client ID, all three pools pair with USDC in one hop, and calldata builds with a contract as sender and recipient. Details in 05. Still to do: the daily depth script, request limits, and re-measuring the depth table one consistent way.

- [~] **BE-05 · Real cross-chain deposit (spike)**
  - Do: get an Aurora Intents API key; send $5 from another chain to USDC on Monad; record the time and fee; try a small transfer of MON; read the documentation on running a step when the funds arrive.
  - Done when: the source and destination transaction hashes are recorded in PROGRESS.md; 05 is updated; Q-10 is answered; the material for Q-09 is handed to Wangsit.
  - Note: price-only quotes from Base, Arbitrum and Ethereum to USDC on Monad work without an API key, and so does a small quote into MON. Results in 05. Still to do: a real deposit, the API key, and the run-on-arrival feature.

- [~] **BE-06 · Indexer on Monad (spike)**
  - Do: read one type of Morpho event on chain 143 with the indexer tool of your choice.
  - Done when: that event is in the database; if the default tool does not fit, the replacement is recorded as a decision in 09.
  - Note: Envio's documentation lists Monad mainnet (chain 143) with a HyperSync endpoint. Not run yet, and whether an API token is needed is unknown.

---

## M1. Core long

- [ ] **BE-10 · Chain reader**
  - Needs: SC-03.
  - Do: one layer for reading the oracle, the Morpho market state and positions through `Lens`, with a short cache and handling of RPC endpoint limits.
  - Done when: all endpoints use it; no other part calls the RPC endpoint directly.

- [ ] **BE-11 · Markets, market session and price stream**
  - Needs: BE-10.
  - Do: `GET /v1/markets`, `GET /v1/session`, `GET /v1/stream`.
  - Done when: the numbers match direct reads from the chain; the stream sends a new price within a few seconds of it being published on chain.

- [ ] **BE-12 · Quote engine for long**
  - Needs: BE-04, BE-10, BE-16, the ABI from SC-03. For simulation it needs SC-14.
  - Do: `POST /v1/quote/open`, `/v1/quote/close`, `/v1/quote/collateral` for long. Compute the loan amount from the leverage; request a route; build the router calldata; simulate against the chain; fill in the gas limit; fill in warnings and the required approvals.
  - Done when: the transaction data from a quote runs successfully on the local fork for open, reduce and full close; the displayed summary matches the real result within the requested slippage tolerance.

- [ ] **BE-13 · Indexer**
  - Needs: BE-06, SC-03. Addresses from SC-14.
  - Do: read router events and Morpho events for our markets; build tables for positions, history, average entry price, and profit and loss. Handle users who use Morpho directly.
  - Done when: positions in the database match `Lens` for all test addresses; replaying the reads from the start gives the same result.

- [ ] **BE-14 · Account and history**
  - Needs: BE-10, BE-13.
  - Do: `GET /v1/accounts/:address` and `/history`.
  - Done when: a newly opened position shows up within a few seconds; profit and loss match hand calculations on three examples.

- [ ] **BE-15 · Backend staging**
  - Needs: BE-11, BE-14.
  - Do: deploy the API, indexer and database on the service of your choice; choose a paid RPC endpoint provider; `GET /v1/status`.
  - Done when: Nabil uses the staging address from the deployed web app.

- [ ] **BE-16 · Shared formulas**
  - Needs: SC-13 for comparison tests.
  - Do: `packages/shared/math.ts` with all the formulas in 04 using integers; `gaps.ts` with the price gap table.
  - Done when: tests compare the results with `Lens` on the local fork for long and short; Wangsit has reviewed it.

---

## M2. Short and Earn

- [ ] **BE-20 · Quote engine for short**
  - Needs: BE-12, SC-21.
  - Do: open and close short. On close, buy slightly more stock than the debt so it is sure to be enough, and show the remainder in the summary.
  - Done when: open, reduce and full close of a short succeed on the local fork from the quote data.

- [ ] **BE-21 · Earn**
  - Needs: SC-23.
  - Do: `GET /v1/earn` and `/v1/earn/:address`: interest, amount supplied, share that is borrowed, amount that can be withdrawn now, for the USDC vault and the stock markets.
  - Done when: the numbers match direct reads from the chain.

- [ ] **BE-22 · Indexer for Earn**
  - Needs: BE-13, SC-23.
  - Do: vault events and supply and withdraw events in the stock markets go into the history.
  - Done when: the Earn history and the interest received show correctly for the test addresses.

- [ ] **BE-23 · All stocks and market detail**
  - Needs: SC-22, BE-04.
  - Do: support aHOOD and aBIL in all endpoints; `GET /v1/markets/:symbol` with the latest market depth, interest history, and DEX-to-oracle deviation history.
  - Done when: all five markets show with the correct numbers.

---

## M3. Market-hours protection

- [ ] **BE-30 · Exchange calendar and calendar poster**
  - Needs: BE-03, SC-11.
  - Do: a close and open calendar (US exchange holidays, daylight saving changes, the Anchored session schedule from BE-03); a program that writes `nextCloseAt` to `RiskManager`.
  - Done when: `nextCloseAt` on chain is correct for the next four weeks, including one holiday; if this program stops, the team gets an alert.

- [ ] **BE-31 · Protector keeper**
  - Needs: SC-30, BE-20.
  - Do: watch positions that have protection switched on; when the time comes (see the order in 04) and a position is above the soft limit, compute the deleverage size with the formula in 04, request a route, call `deleverage`. Retry on failure; log every action.
  - Done when: on the local fork, positions above the limit are reduced to the target; positions without protection are not touched.

- [ ] **BE-32 · Liquidator bot**
  - Needs: SC-32.
  - Do: watch all positions in our markets, including those of people who use Morpho directly; call `Liquidator` when a position passes the hard limit.
  - Done when: on the local fork, a position made unhealthy is liquidated within a few blocks.

- [ ] **BE-33 · Alerts for users**
  - Do: sign in with a wallet signature (`/v1/auth/siwe`); `GET` and `PUT /v1/alerts`; delivery channels (proposal: email and Telegram); a schedule of 24 hours, 4 hours and 1 hour before close; alerts when the LTV passes a threshold, when auto-deleverage happens, and when liquidation happens.
  - Done when: a test address receives all three before-close alerts at the right times.

- [ ] **BE-34 · Gap scenarios**
  - Needs: BE-16.
  - Do: fill `gapScenarios` in quotes and in accounts; a periodic job that updates the gap table from the market data source and tells the team when the worst number changes.
  - Done when: the scenarios in the summary match the formula in 04; the gap table can be regenerated from a script.

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
  - Do: every row in the "What we monitor" table in 08; alerts to the team channel.
  - Done when: each row has been triggered once on purpose and its alert arrived.

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
  - Do: one key per role; proper secret storage; MON top-ups with a limit; a way to rotate keys.
  - Done when: there are no keys in the repo or in notes; how to rotate keys is written down and has been tried.

---

## M6. Launch

- [ ] **BE-60 · Production backend**
  - Needs: SC-60.
  - Do: a production environment separate from staging; production addresses; keepers with production keys.
  - Done when: all endpoints answer correctly against the production contracts; all keepers send a heartbeat.

- [ ] **BE-61 · Status page**
  - Done when: the public can see the state of the oracle, keepers, API and indexer.
