# Backend tasks (Dharu)

Folder: `apps/api/`, `apps/indexer/`, `apps/keeper/`, `apps/agent/`, `packages/db/`, `packages/swap/`, `packages/intents/`, `packages/cctp/`, `packages/tapeout/`, plus `packages/shared/api/`, `math.ts`, `gaps.ts`. `deploy/` (BE-90).

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 02-architecture.md, 03-interfaces.md, 04-risk-rules.md, 05-addresses-and-services.md.

Tasks marked **(spike)** exist to prove an assumption. Write the result in the document named in the task, whatever the result is.

Three rules for the backend:

1. The backend never holds user keys and never sends transactions on behalf of a user.
2. If an outside service is down, answer with a clear error. Never give an approximate number.
3. The source of truth is the chain. The database is only a copy, to make things faster and to keep history.

---

## Execution plan (20 November to 6 December 2026)

Written on 20 November 2026, after Railway stopped (D-94). It puts every open backend task in one order, so the backend never holds up Wangsit or Nabil and never works in their areas. Dates follow D-58. When a date slips, change this section and write it in the daily log the same day. Hosting design: [`docs/hosting.md`](../hosting.md).

### Team dates and what the backend owes for each

| Date | Team goal (D-58) | Backend ready by then |
|---|---|---|
| 21 November | Backend back online without Railway | Monad API, indexer and keeper on the VPS (BE-90, BE-91) |
| 23 November | Base and X Layer deployments unblocked | BE-92, BE-93, BE-94, and the Base and X Layer keeper addresses (BE-55) |
| 26 November | Long on Base live | Chain routes (BE-70), Base long quotes (BE-72), indexer and keeper on Base (BE-73), Builder Codes (BE-74), liquidation margin (BE-89) |
| 27 November | First Base weekly close, 20:00 New York time (Saturday 08:00 WIB) | Base calendar post (BE-30), keeper reduction sizing (BE-88) |
| 1 December | Short and Earn on Base | Base short quotes and Earn data (BE-72), pause monitor (BE-75), stats (BE-79) |
| 3 December | X Layer live | X Layer quotes (BE-81), indexer and keeper (BE-80), TapeOut circuits and PnL proofs (BE-82 to BE-86) |
| 4 December | Base submission (X-34) | Stats, transaction hashes, the list of backend work done since 5 November |
| 6 December | OKX submission (X-37) | Circuit and proof addresses, the list of backend work done since 16 October |

26 November is Thanksgiving: the US market is closed, and the Base feeds may not write that day (BE-97 checks it). The first public Base trade should not depend on a fresh price that day.

### Day by day

Priority: P0 is on the path to a team date, P1 is needed for a submission, P2 only if time allows. If a day slips, drop P2 first, then move P1. Never move a P0 without telling Wangsit and Nabil.

| Day | Tasks | Priority | Done at the end of the day |
|---|---|---|---|
| Fri 20 Nov | This plan and D-94. Order the VPS. BE-91 step 1 (read what Railway still has). Start the `deploy/` files on `be/BE-90-vps` | P0 | Plan in the docs; the Railway export done, or known to be impossible |
| Sat 21 Nov | BE-90, BE-91, the BE-55 key script for the VPS, first backup on the VPS (BE-53). Answer Q-40 (BE-82) | P0 | `/v1/status` green on the new address; the address sent to Nabil |
| Sun 22 Nov | BE-92, BE-93. The BE-70 proposal in 03 sent to Nabil. Base and X Layer role keys made on the VPS, addresses sent to Wangsit (BE-55) | P0 | Two blocker rows for Wangsit closed (limits check, gap rows) |
| Mon 23 Nov | BE-94 (morning), BE-95 | P0 | Review notes with Wangsit; Monad runs with `chain_id` |
| Tue 24 Nov | BE-97 on Base and X Layer, BE-89, BE-70 build (after Nabil agrees) | P0 | Feeds recording before Thanksgiving; chain routes live with Monad aliases |
| Wed 25 Nov | BE-96 (interface, KyberSwap, 1inch), BE-72 long, BE-74, BE-99. BE-52 if the domain exists | P0 | Base long quotes pass a live simulation; a close quote works without an oracle price |
| Thu 26 Nov | BE-73 with the Base deployment file (SC-76), BE-30 for Chainlink chains. I-B1 with Wangsit and Nabil | P0 | A real long on Base through the web app, hashes in PROGRESS |
| Fri 27 Nov | BE-88 (before the close), BE-96 (Aero), BE-98 if SC-87 has run | P0 | The protector can act on Base |
| Sat 28 Nov | BE-72 short and Earn, BE-75 | P0 | Base short quotes and Earn data on the live chain |
| Sun 29 Nov | BE-79, BE-82, BE-81 | P1 | Stats live for FE-75; TapeOut facts in 05; X Layer quotes on a fork |
| Mon 30 Nov | BE-80 (with the X Layer deployment file when SC-83 lands), BE-77 | P1 | X Layer in the API; agent routes proposed in 03 |
| Tue 1 Dec | Base short and Earn live with SC and FE. BE-83, BE-86 | P1 | Circuits tested against `math.ts` and `calendar.ts` |
| Wed 2 Dec | BE-84, BE-80 live, BE-77 prepared actions for FE-77 | P1 | A PnL proof posted from a real close |
| Thu 3 Dec | I-X1 with Wangsit and Nabil. Buffer | P1 | X Layer live, hashes in PROGRESS |
| Fri 4 Dec | Support X-34 (numbers, hashes, work list). BE-78 if time | P1, P2 | Base submission received |
| Sat 5 Dec | Buffer. Support the OKX video | P1 | |
| Sun 6 Dec | Support X-37 | P1 | OKX submission received |
| From 7 Dec | BE-76, BE-85, BE-54, BE-60, the BE-53 and BE-55 drills, and BE-52 if it is not done | P2 now, P0 before launch | |

BE-87 is not planned for this round: its own rule is "only if time allows before 3 December 2026", and the days above have no room.

### What the backend needs from others

| What | From | Needed by | For |
|---|---|---|---|
| The domain (Q-25) and access to its DNS | Nabil | 24 November | A stable API address (BE-90) and the US block on Base (BE-52, D-73) |
| Agreement on the chain routes proposal in 03 | Nabil | 23 November | BE-70 |
| `NEXT_PUBLIC_API_URL` set to the VPS address | Nabil | Right after BE-90 | The web app has no backend until then |
| The Base Builder Code added to the Base transactions the web app builds itself (Earn, D-07) | Nabil | 26 November | BE-74 |
| A read-only deploy key on the repo for the VPS (repo admin) | Wangsit | 21 November (SSH agent forwarding works until then) | BE-90 |
| Team keys for the 1inch Swap API and the OKX DEX API, put straight into the VPS secret files | Wangsit | 25 November (1inch), 29 November (OKX) | BE-96, BE-81 |
| Base deployment file, with our keeper addresses in the roles | Wangsit | 26 November (SC-76) | BE-72 final test, BE-73 |
| X Layer deployment file, the same | Wangsit | 30 November (SC-83) | BE-80 |
| The new Monad router, and the keeper role for the protector on it | Wangsit | After BE-94 (SC-87) | BE-98 |
| ETH on Base and OKB on X Layer for the role keys; OKB for TapeOut transistors and proofs | All three (X-31, X-35) | With SC-76 and SC-83; 29 November for TapeOut | BE-73, BE-80, BE-82, BE-84 |

### What the backend gives others

| What | To | By | Task |
|---|---|---|---|
| The new API address | Nabil | 21 November | BE-90 |
| Base and X Layer limits checked against `math.ts` | Wangsit | 22 November | BE-92 |
| Gap rows for the Base and X Layer stocks | Wangsit | 22 November | BE-93 |
| Keeper addresses for Base and X Layer, four per chain | Wangsit | 22 November | BE-55 |
| Chain routes proposal in 03 | Nabil | 22 November | BE-70 |
| Written review of the router, liquidator and swap target changes | Wangsit | 23 November | BE-94 |
| Base long quotes | Nabil | 25 November | BE-72 |
| `nextCloseAt` posts for Base and X Layer | Wangsit | Before the first Friday close after each deployment | BE-30 |
| Base short quotes and Earn data | Nabil | 28 November | BE-72 |
| TapeOut facts for the DeWEB mirror | Nabil | 29 November | BE-82 |
| Stats endpoint | Nabil | 29 November | BE-79 |
| X Layer quotes | Nabil | 1 December | BE-81, BE-80 |
| Circuit addresses and IDs, proof format | Nabil, Wangsit (SC-85) | 2 December | BE-83, BE-84, BE-86 |
| Prepared agent actions for signing in the app | Nabil | 2 December | BE-77 |

### Dharu's items outside the code

| Item | By | Note |
|---|---|---|
| Order the VPS | 21 November | Rules in `docs/hosting.md` |
| Uptime check and off-site backup accounts | 22 November | BE-90, BE-53 |
| Paid RPC for Monad, Base and X Layer | 24 November | Base must support `eth_simulateV1`. Public endpoints until then |
| Envio HyperSync token | 24 November | Existing blocker. Check whether HyperSync serves Base and X Layer (not verified) |
| Builder Code registration for Base | 25 November | BE-74 |
| Q-40, TapeOut transistors | 21 November | BE-82 |
| X-32 (partners) and Q-33 | 25 November | |
| X-36 (TapeOut and X Layer contacts) | 28 November | |
| KyberSwap API key | Open | Existing blocker. Base quotes start without it |

### Boundaries, so nothing overlaps

- The backend never edits `contracts/`, `apps/web/`, or Wangsit's files in `packages/shared` (`abis/`, `addresses.ts`, `markets.ts`, `chains.ts`, `deployments*.ts`). A needed change there becomes a blocker row for the owner.
- Wangsit proposes the limits in 04. The backend checks them (BE-92) and keeps `math.ts` and `gaps.ts` in step.
- The backend builds every router transaction (D-19). The web app builds Earn transactions itself (D-07). Both add the Base Builder Code from one constant in `packages/shared/api` (BE-74).
- The backend never holds user keys. The agent prepares and the user's wallet signs (BE-77).
- TapeOut: the backend builds the circuits and the proofs, the web app shows them (FE-81, FE-82, FE-83), Wangsit reviews them (SC-85).
- 1Click work stops (D-50). The current deposit routes stay up on Monad until BE-76 replaces them.
- A new backend folder or package (`deploy/`, `packages/swap`, later `packages/bridge`, `packages/tapeout`, `apps/agent`) gets its ownership row in CLAUDE.md, the README, 06 and CODEOWNERS in the PR that creates it.

### When blocked, close these small items

- BE-33: one real Telegram alert through the web app's link flow.
- BE-50: see each team alert arrive once.
- BE-53: a restore check on the VPS.
- BE-61: the status address on our domain once Q-25 is decided.

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
  - Note (20 November 2026): superseded by BE-76. D-50 replaces 1Click with CCTP and Across, so no real 1Click deposit is made. Closed together with BE-76.

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
  - Note: fixed on 14 October 2026 (found in the end-to-end check on staging): adding stock collateral to a long, or repaying a short's stock debt, answered 502 because the quote read the permit nonce of a stock token, which has no permit and reverts. The permit nonce is now read only for USDC; stock tokens get a plain approve. Checked against mainnet for every market token. The fork tests never covered these two paths.

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
  - Note: deployed on Railway on 14 October 2026 (D-41): project `levra`, services `api`, `indexer`, `keeper` and `Postgres`, all running from `main`. The API is at `https://api-production-c154.up.railway.app` (`/v1/health` and `/v1/status` answer). The first deploy crashed on placeholder variables pasted from the templates; fixed, and empty variables now count as not set. Running on the public RPC `rpc2.monad.xyz` until a paid provider is chosen. `CORS_ORIGINS` and `AUTH_DOMAIN` allow production, this project's Vercel previews (`levra-*-wangsit-nursyahadas-projects.vercel.app`) and `localhost:3000`; a live preflight from each passed and another origin got no CORS header. Not set yet: keeper role keys, team and user alert channels, and `TERMS_VERSION`. Still to do: a paid RPC endpoint and Nabil pointing the web app at the staging address.
  - Note (20 November 2026): Railway stopped (the old API answers 404) and the backend moves to a VPS (D-94). The remaining work, hosting and a paid RPC, continues in BE-90. BE-15 is closed together with BE-90.

- [x] **BE-16 · Shared formulas**
  - Needs: SC-13 for comparison tests.
  - Do: `packages/shared/math.ts` with all the formulas in 04 using integers; `gaps.ts` with the price gap table. Include the "price used" rule from 04 (long: lower of price and best bid, short: higher of price and best ask) with the fallback to the price alone, checked on every read so the code does not depend on the answer to Q-19. The fallback condition must match `SessionOracle` exactly, as written in 04.
  - Done when: tests compare the results with `Lens` on the local fork for long and short, including a zero and a non-sensible bid and ask; Wangsit has reviewed it.
  - Note: `math.ts` and `gaps.ts` are written with unit tests on the examples in 04 (price scale, LTV, liquidation price, distance, gap, leverage table, bonus, APY, deleverage size). Each formula follows the contract code, including rounding (`RiskManager.positionLtv`, `Lens._liqPriceE8`, `SessionOracle`). The fork test in `apps/api/test/fork.test.ts` opens a real long and short on Morpho and gets exactly the same LTV and liquidation price as `Lens`, and the same Morpho price as `SessionOracle.price()`. A zero or non-sensible bid and ask cannot be produced on a fork of the live oracle, so those cases are covered by unit tests only.
  - Note: reviewed by Wangsit on 13 October 2026: the formulas match the contracts. His two notes are fixed (14 October): the long liquidation price now divides by `collateral × lltv` in one step as `Lens` does since PR 13, with a unit test where the old rounding would differ; and the open quotes send `maxLtv` with 1 bps of the LTV as room for interest that accrues on existing debt before the block, so a fill exactly at the worst case no longer trips `UserLimitExceeded`.

- [x] **BE-17 · Oracle age poster (keeper)**
  - Needs: BE-03, and a bounded `maxOracleAge` setter with its own role in `RiskManager` (done by Wangsit: D-31, `setOracleAgeBounds` and `setMaxOracleAge`).
  - Do: a keeper in `apps/keeper` that computes `maxOracleAge` per market from the BE-03 tables with the formula in 04, and posts it on chain. It does nothing until the data meets the minimum in 04; until then the value set at deployment stays. It posts only when the new value differs from the chain value by more than a small step, and never outside the bounds the multisig set. Every post is logged with the input numbers. Its key is used for this role only (BE-55).
  - Done when: on the local fork, the poster sets the value from recorded data; does nothing with too little data; is rejected outside the bounds; the team gets an alert for every change (BE-50). After launch no person has to touch code, the repo or the multisig for this value to follow the data.
  - Note: written on 13 October 2026. The keeper job `oracleAgePoster` (on only when `ORACLE_AGE_POSTER_KEY` and `DEPLOYMENT_FILE` are set) checks its key is the registered poster, takes the proposal per stock from the BE-03 tables, keeps it inside the owner's bounds, skips changes under 10% and posts `setMaxOracleAge` for every market of the stock, logging the inputs. Fork tests: five markets moved on chain, a value above the cap kept at the cap, small changes and too little data left alone, a wrong key refused. Run on the real two weeks of data: QQQ 2,100 s, HOOD 2,160 s, BIL 3,060 s, which equal the values the deployment script already sets, so nothing was posted. Still to do: the team alert on every change, which comes with BE-50; until then each change is a warning in the keeper log and in its heartbeat.
  - Note: done on 14 October 2026. The team monitor (BE-50) posts "maxOracleAge of <market> changed from A to B seconds" for every change it reads on chain, to the team Telegram group, which is live on staging (a test message arrived). On mainnet the poster holds its role (granted by Wangsit) and 10 MON, and reports healthy; it has posted nothing yet because the data still matches the deployed values. Not verified yet: a real change arriving in the group, which happens the first time the data moves a value by more than 10%.

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

- [x] **BE-24 · Price history for charts**
  - Needs: BE-03 (the `oracle_updates` table), BE-23.
  - Do: `GET /v1/markets/:symbol/prices?range=1D|1W|1M` for the Markets sparklines and the Trade chart (FE-14, asked for by Nabil on 14 October 2026). Oracle price on a fixed grid, carried forward while the oracle does not write, ending with the latest price (D-43). An interface addition in 03 and `packages/shared/api`.
  - Done when: the endpoint answers on staging with the recorded oracle data for all three stocks; Nabil has approved the shape.
  - Note: written on 14 October 2026. `oraclePriceSeries` and `latestOraclePrice` in `packages/db` read `oracle_updates` by its `(symbol, block_time)` index; the API spaces points every 5 minutes (1D, 288), 1 hour (1W, 168) or 4 hours (1M, 180) and caches each chart for 10 seconds. Tests: grid and last point without a database, 400 and 404, and a DB test that checks the carry forward, times before the first write left out, and all three ranges ending with the latest price. Not verified yet: staging. The logger backfills `ORACLE_BACKFILL_BLOCKS` on its first start (4,000,000 blocks in `.env.example`, about two weeks), so 1M stays short until a full month is recorded.
  - Note: done on 14 October 2026. Checked on staging: QQQ, HOOD and BIL each answer 289 points for 1D, 169 for 1W and 86 for 1M (data since 29 September 2026). Nabil built FE-14 on this shape and checked it against staging.

---

## M3. Market-hours protection

- [~] **BE-30 · Exchange calendar and calendar poster**
  - Needs: BE-03, SC-11.
  - Do: a close and open calendar (US exchange holidays, daylight saving changes, the Anchored session schedule); a program that writes `nextCloseAt` to `RiskManager`. The Anchored schedule is read from the session changes recorded by BE-03, never typed into the code. Until a weekend close has been observed, post the earliest possible close (the regular close on the last trading day), because an early close is safe and a late one is not. The program switches to the observed schedule by itself once the data has it.
  - Done when: `nextCloseAt` on chain is correct for the next four weeks, including one holiday; on the local fork it posts the early close with no weekend data and the observed close after a weekend is recorded, with no code change in between; if this program stops, the team gets an alert.
  - Note: BE-03 data shows the weekly close at Friday 20:00 ET, with the session flipping between `POST_MARKET` and `CLOSED` until about 20:15. The close time is the first `CLOSED` write, not the last flip.
  - Note: `packages/shared/calendar.ts` (NYSE holidays and early closes from their rules, daylight saving from the time zone, the Anchored schedule as an observed offset with the regular close as fallback) and `observedClosedStretches` in `packages/db` are written with tests.
  - Note: the `calendar` keeper job is written (13 October 2026). Every 10 minutes it takes the schedule from `observedClosedStretches` (the regular close until a weekend is in the data), computes the next close on the chain's clock and posts it with `setNextCloseAt`. A close that just passed stays on chain through the contract's grace hour; a wrong future close is corrected. It runs when `CALENDAR_POSTER_KEY` and `DEPLOYMENT_FILE` are set and checks the key is the poster. Tests: a 10-minute simulation over four weeks around Thanksgiving always holds the right close (including the Wednesday and the 13:00 Friday close); on the fork the same job posts the regular close with no weekend data and moves to the observed close (4 hours later) once a weekend is added. Still to do: posting on mainnet, which needs the calendar poster role and hosting, and the alert when the job stops (BE-50, from its heartbeat).
  - Note (20 November 2026): Base and X Layer need their own posts to their own `RiskManager`: Friday 20:00 New York time, when the Coinbase and xStocks feeds freeze (04). The observed Anchored schedule stays for Monad only. For a holiday or an early close, post the earliest time a feed could freeze until BE-97 has seen one; Thanksgiving week (26 and 27 November) comes first. Running it on those chains is part of BE-73 and BE-80.
  - Note (22 November 2026): the Base and X Layer schedule is written. `FEED_SCHEDULE` in `packages/shared/calendar.ts` closes a full Friday at Saturday 00:00 UTC and reopens Monday 01:00 UTC, the clock of `ChainlinkSessionOracle` (Friday 19:00 New York time in winter, 20:00 in summer; changed after Wangsit's review of #109, since 20:00 was an hour late in winter); before a holiday or on an early close it keeps the exchange close. `scheduleForChain` in the poster gives Monad the observed Anchored schedule and the other chains `FEED_SCHEDULE`, and the protector, alerts and monitor use the same source. The calendar job now starts on every chain when `CALENDAR_POSTER_KEY` and `DEPLOYMENT_FILE` are set. Tests: a 10-minute simulation over four weeks around Thanksgiving (19:00 Fridays, 16:00 Wednesday 25, 13:00 Friday 27) and across the November 2026 and March 2027 daylight saving changes, with Good Friday. After a Thursday close before Good Friday the next Friday close is more than 8 days away, so nothing is on chain for a few hours that day; the closed regime still starts from the oracle (Saturday 00:00 UTC on Base). Still to do: the poster role and key on Base and X Layer (BE-73, BE-80) and a check of the first holiday freeze (BE-97).

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

- [x] **BE-34 · Gap scenarios**
  - Needs: BE-16.
  - Do: fill `gapScenarios` in quotes and in accounts; a periodic job that updates the gap table from the market data source and tells the team when the worst number changes.
  - Done when: the scenarios in the summary match the formula in 04; the gap table can be regenerated from a script.
  - Note: one `gapScenarios` helper in `packages/shared/gaps.ts` fills quotes and accounts for long and short, with tests against the formula in 04; `gapStatsFromBars` rebuilds a table row from daily bars.
  - Note: done on 14 October 2026. `pnpm --filter @levra/keeper report:gaps` reads five years of daily prices from Yahoo Finance's chart API (the table's source, split-adjusted, no key) and prints the rebuilt table next to the current one; `--write` replaces it in `gaps.ts`. A run on 14 October gave the same worst drop and rise as the table for all eight stocks. It counts 275 events per stock where the table says 261, because it also counts single holidays in the middle of a week, so the "gaps over 2%" share moves by up to 1.3 points; the table was not rewritten. The team monitor (BE-50) reads the prices once a day and alerts when a stock we list had a gap worse than the table, which asks for a rebuild and a check of the closed-market limits in 04.

---

## M4. Cross-chain deposits

- [~] **BE-40 · Deposit service**
  - Needs: BE-05.
  - Do: `GET /v1/deposit/tokens`, `POST /v1/deposit/quote`, `GET /v1/deposit/:id`; store every deposit; watch the status until it is completed, refunded or expired; include a MON transfer when requested.
  - Done when: real deposits from two different chains arrive and their status shows correctly; a failed deposit is refunded and recorded.
  - Note: written on 14 October 2026. 1Click client in the new `packages/intents` (owner: Dharu), shared by the API and the keeper. The API lists the tokens of every other chain, quotes exact-input deposits into USDC on Monad (1% slippage), adds the MON top-up as a second small transfer (D-40), stores every transfer with the whole signed quote in `deposits`, and refreshes a status from the service at most every 10 seconds. The keeper job `transfers` follows open transfers every 15 seconds for 4 days. Tested with a stand-in service and Postgres, plus a live quote and status read from 1Click (no funds). Still to do: real deposits from two chains, a refund, and the partner token (`INTENTS_JWT`), which may remove the service's 0.2% fee.
  - Note (20 November 2026): superseded by BE-76 (D-50). The routes stay live on Monad until BE-76 replaces them; no new 1Click work.

- [~] **BE-41 · Withdraw to another chain**
  - Needs: BE-40.
  - Do: `POST /v1/withdraw/quote` from USDC on Monad to another chain.
  - Done when: one real withdrawal succeeds and is recorded.
  - Note: written on 14 October 2026 with BE-40: the quote goes from USDC on Monad to the chosen token, a refund goes back to the user's own Monad wallet, and the status is followed like a deposit. Still to do: one real withdrawal.
  - Note (20 November 2026): superseded by BE-76 (D-50).

- [~] **BE-42 · Notification when funds arrive**
  - Needs: BE-40, BE-33.
  - Do: notify the app (through the stream) and the user (through the alert channels) when a deposit arrives.
  - Done when: the app moves to "funds arrived" without a reload.
  - Note: the app learns of the arrival from `GET /v1/deposit/:id`, which the web app polls every 5 seconds until the status is final and which reads the service at most every 10 seconds, so no stream event is needed; the public stream has no user. The `transfers` keeper keeps the stored status current with the app closed, and the alerts keeper (BE-33) sends "Deposit arrived" from it. Still to do: see it with a real deposit.
  - Note (20 November 2026): superseded by BE-76 (D-50). The arrival alert carries over to the CCTP and Across transfers.

---

## M5. Hardening

- [~] **BE-50 · Monitoring and alerts for the team**
  - Do: every row in the "What we monitor" table in 08; alerts to the team channel. Grows out of the BE-03 logger. The "price too old" limit is computed per session from the BE-03 data, not typed in. Until a session has enough samples, use a strict default and mark the monitor as learning in `/v1/status`. The expected session schedule comes from the same source as BE-30.
  - Done when: each row has been triggered once on purpose and its alert arrived; a normal weekend with no updates raises no alert once the weekend is in the data.
  - Note: the Friday 20:00 to 20:15 ET session flipping seen in BE-03 is normal for this oracle and must not raise a "session outside schedule" alert.
  - Note: written on 14 October 2026. Keeper job `monitor` (every minute) checks every row of the 08 table except web app errors (FE-54): oracle age per stock while the calendar says open, against a limit per session from the BE-03 data (99th percentile of the source quote age plus one heartbeat, as in the `maxOracleAge` rule), or the market's `maxOracleAge` as the strict default while a session has fewer than 500 samples, shown in `/v1/status` as `ageLimitLearning`; session against the BE-30 calendar, only once a weekend is observed and only after 30 minutes, so the Friday flips pass; DEX mid against `maxDeviationBps`; keeper heartbeats and errors; every change of `maxOracleAge` and `nextCloseAt` with old and new value; MON of every role key below 5 MON; positions past the hard limit for 5 minutes; bad debt from liquidations; utilization at 95%; the latest depth run against the 04 cap rule (loss to the oracle at the cap size below the liquidation bonus); indexer lag over 300 blocks; and the public API (`MONITOR_API_URL`) failing or slower than 3 seconds for 2 minutes. Alerts go to a Telegram group (`TEAM_TELEGRAM_CHAT_ID` with the BE-33 bot) and/or a Discord or Slack webhook (`TEAM_WEBHOOK_URL`), once per problem, with a RESOLVED message when it ends; state in `monitor_state`. Limits are initial proposals. Tests trigger every row on purpose, check that a normal weekend raises nothing, and run the monitor once on the fork. Still to do: a real team channel and seeing each alert arrive there. The monitor cannot report its own death; an outside uptime check on `/v1/status` is part of BE-15 hosting.
  - Note (20 November 2026): the outside uptime check moves to BE-90 (VPS).

- [x] **BE-51 · Rate limits and abuse protection**
  - Done when: limits per IP address and per wallet work; the quote endpoints cannot be used to use up the quota of outside services.
  - Note: done on 14 October 2026. Token buckets per IP for every route but `/v1/health`; per IP and per wallet for trade quotes and the deposit and withdrawal quotes (the wallet is `user`, or `recipient` for a deposit); per wallet for `/v1/accounts/:address` and `/v1/earn/:address`. A refusal is 429 `RATE_LIMITED` with `Retry-After`, after CORS so the browser can read it. The proxy header is trusted only when `TRUST_PROXY_HEADER` is set, and only its last entry. One global budget on KyberSwap calls (a route costs 1, a quote 2) means no client traffic can use up our KyberSwap quota. In memory, so for one API instance. All limits are initial proposals for BE-54.
  - Note: 14 October 2026, after 429s from KyberSwap on staging: KyberSwap's public limit is 3 requests per second (05) and one open quote sends three at once. The client in `packages/kyber` now starts requests at least 350 ms apart and retries once after a 429; the budget is 12 calls at once plus 60 a minute. An API key (`KYBER_API_KEY`, sent as `X-Api-Key`) raises the limit once KyberSwap gives us one.

  - Note (14 October 2026): after Nabil's report of quote 429s on staging, the per-wallet quote limit went from 10 to 30 a minute and the per-IP quote limit from 20 to 40, and quotes share one DEX mid price per stock for 60 seconds, so a quote makes 2 KyberSwap calls instead of 4. Still initial proposals.

- [~] **BE-52 · Region and terms acceptance**
  - Needs: X-10, X-11.
  - Do: `GET /v1/eligibility` based on region; `POST /v1/terms/accept` with a wallet signature; the quote endpoints reject anyone who has not met the requirements.
  - Done when: requests from a restricted region are rejected with `REGION_BLOCKED`; the acceptance is stored together with the version of the terms.
  - Note: written on 14 October 2026. The country comes from a header set by the CDN in front of the API (`GEO_COUNTRY_HEADER`, for example `cf-ipcountry`); with a block list (`BLOCKED_COUNTRIES`), a request without a country is refused, since it did not come through the CDN. `POST /v1/terms/accept` rebuilds the 03 text (`termsMessage` in `packages/shared/api/compliance.ts`) and checks the signature, smart wallets included, then stores the address, version, signature and country. Only opening a position (`/v1/quote/open`) and a deposit quote are gated; closing, reducing, collateral and withdrawals never are (product rule 8). Without `TERMS_VERSION` the routes are off and the web app cannot pass its gate, so a deployment without terms takes no new positions. Tests: blocked and missing country, gate on open and deposit, no gate on close and withdraw, a wrong signer or old version refused, acceptance stored. Still to do: the country list and the terms version from X-10 and X-11, and the CDN header once hosted (BE-15).
  - Note: proposed country list (D-42, 14 October 2026): Anchored's prohibited jurisdictions, `AF,DZ,BY,CA,CN,CU,KP,ER,IR,LY,MM,MA,NP,RU,SO,SS,SD,SY,US,VE`, pending counsel. Railway gives no country header, so enforcement needs a CDN in front of the API (for example Cloudflare, `cf-ipcountry`) on our own domain (Q-25). Not set on staging yet: setting `BLOCKED_COUNTRIES` without that header stops the API at start, by design.
  - Note: regions inside a country can be refused too (14 October 2026): `GEO_REGION_HEADER` (Cloudflare's `cf-region-code` from its visitor location headers) and `BLOCKED_REGIONS` in ISO 3166-2, for the sanctioned Ukrainian regions in D-42. Cloudflare documents the region code without the country (`TX`), so the API adds the country; a value with the prefix is taken as it is. Not verified on a live request yet. Without a region the country decides, so the rest of Ukraine stays open.
  - Note (20 November 2026): on the VPS (D-94), Cloudflare goes in front of the API once the domain exists, and the server takes traffic from Cloudflare only, so the country header cannot be forged (`hosting.md`). Base and X Layer also block the D-73 countries (GB, AU, SG, CH), so `/v1/eligibility` takes the chain. Needed before the Base submission: the Base form puts projects open to US users out of scope.
  - Note (22 November 2026): built on `be/BE-52-cloudflare-origin` (D-103). `ORIGIN=cloudflare` in `caddy.env` makes Caddy close every connection from outside Cloudflare's ranges; `deploy.sh` refuses a mismatch with the API's headers and validates the Caddy config first; the Caddy config moved to `deploy/caddy/` (mounted as a folder, so a checkout reaches the running Caddy) and `deploy.sh` reloads it. Per chain lists `BASE_BLOCKED_COUNTRIES` and `XLAYER_BLOCKED_COUNTRIES`, `/v1/eligibility?chainId=`, and the open quote checked against its chain's list. Tests: chain lists, missing country on a chain with a list, the gate per quote route, bad chain IDs, the env guard on six env pairs. Left: turn the proxy on with the steps in `hosting.md` ("Cloudflare in front"), check a live `cf-region-code` value, and the country lists and terms version from X-10 and X-11 (then set `TERMS_VERSION`, without which the web app cannot pass its gate).

- [~] **BE-53 · Backups and incident runbook**
  - Do: regular database backups and a restore test; a runbook for the six situations in 07, stored in `docs/`.
  - Done when: a restore from backup has been tried; the runbook has been read by all three of us and practiced once.
  - Note: backup, restore and restore-check scripts in `packages/db/scripts` (`pg_dump` custom format, restore in one transaction, the check compares every table's row count between the counts before and after the dump). The restore test passed on 13 October 2026 on `levra_staging` and `levra` (results in the runbook). Runbook: `docs/runbook.md`, the six situations in 07 plus backup and restore. Still to do: scheduled backups and off-site copies on the hosted database (BE-15), all three reading the runbook, and one drill.
  - Note (20 November 2026): on the VPS, a daily backup keeps 14 dumps and copies each one off the server, with a weekly restore check (`hosting.md`). The first backup runs on the day of the move (BE-90).

- [~] **BE-54 · Load test**
  - Done when: the quote and account endpoints hold up at the target load without passing the limits of the RPC endpoint and outside services; the result is recorded.
  - Note: the harness `apps/api/loadtest/run.ts` runs the real API with the BE-51 limits on and counts the JSON-RPC and KyberSwap calls per request. First run on a local fork: 50 users, 0.70 RPC calls per API request, KyberSwap kept inside the budget; the KyberSwap budget refused most quotes at 50 users, so it needs KyberSwap's real limit. Report: `docs/reports/loadtest-2026-10-13.md`. Still to do: the run against staging with the paid RPC (BE-15) at a target load agreed by the team.

- [~] **BE-55 · Keeper key management**
  - Needs: SC-55.
  - Do: one key per role (calendar poster, oracle age poster, protector, liquidator); proper secret storage, never in `.env` files on servers or in logs; keepers run apart from the public API; MON top-ups with a limit; a way to rotate keys, where the multisig removes the role from the old address.
  - Done when: there are no keys in the repo or in notes; how to rotate keys is written down and has been tried, including a drill where the oracle age poster key is treated as leaked.
  - Note: written on 14 October 2026. `docs/keys.md` covers the four roles, where keys live (only the keeper service's variables on Railway), making them, MON top-ups and rotation. `pnpm --filter @levra/keeper keys` makes keys and stores them on Railway through stdin, printing only addresses and the line for `make set-roles-monad`; `topup` funds role wallets from a person's funding key within limits (10 MON target, 10 per wallet, 30 per run, initial proposals). The keeper log blanks key fields. Leak drill passed on a fork: one owner call moved the oracle age poster role, the leaked key was refused, the new key posted. On 14 October 2026 the mainnet keys were made with the script, granted by Wangsit and funded (05); all keepers report healthy. Still to do: the drill on mainnet after SC-55.
  - Note (20 November 2026): Railway is gone (D-94). On the VPS each secret is one file, mounted read only into the one service that needs it (`hosting.md`). The `keys` script writes to that folder instead of the Railway CLI and makes one key per role per chain (Monad, Base, X Layer); `docs/keys.md` is rewritten for the VPS. The script change is needed on 21 November for BE-91, and the Base and X Layer keys on 22 November for Wangsit's deploy configs.
  - Note (20 November 2026, later): done in code on `be/BE-90-vps`. `keys.ts` takes `--dir` and writes each key as a 0400 file (a rotation writes a new file, then renames it); `deploy/keys.sh` runs it on the server inside the keeper's image; `move-variables.ts` moves keys off Railway. `docs/keys.md` rewritten for the VPS. Tested in the local copy of the server setup.
  - Note (20 November 2026): Wangsit asked for the four Base and X Layer role addresses (`KEEPER`, `LIQUIDATOR_KEEPER`, `CALENDAR_POSTER`, `ORACLE_AGE_POSTER`) for the deploy configs. Not sent yet: the keys are made on the VPS (21 November). `keys.ts` needed a deployment file, which Base and X Layer do not have before the deploy; it now takes `CHAIN_ID` instead and prints the deploy variables (`be/BE-55-keys-before-deploy`). Next: on the VPS, `deploy/keys.sh keeper-base ... --confirm` and `keeper-xlayer`, then send the two lines to Wangsit (by 22 November).


- [x] **BE-56 · CORS and sign-in hosts for the web app**
  - Needs: BE-33.
  - Do: let the web app's production, preview and local origins call the API from the browser, including the `Authorization` header, and accept a sign-in message from those hosts; refuse every other origin.
  - Done when: a preflight and a call from a listed origin get the CORS headers and a sign-in from a listed host works; other origins and hosts are refused.
  - Note: done on 14 October 2026 at Nabil's request. `CORS_ORIGINS` and `AUTH_DOMAIN` are comma-separated lists where `*` stands for one part made of letters, digits and dashes, never a dot, so `https://levra-mon-*-<team>.vercel.app` matches this project's previews and not every vercel.app site. Without `CORS_ORIGINS` the API sends no CORS headers. Tested: patterns, preflight with `authorization`, a refused origin, sign-in from a preview host and refusal of another project's.

---

- [x] **BE-88 · Keeper sizes reductions to the router floor**
  - Needs: the router with `DELEVERAGE_FLOOR` (D-91).
  - Do: in `apps/keeper/src/protector/protector.ts` (`planLong`, `planShort`), size each reduction to end between the soft limit and `currentSoftLtv - DELEVERAGE_FLOOR` (read the constant from the ABI), keep the collateral taken out within the D-92 size bound (`DELEVERAGE_SLACK_BPS`), drop the `type(uint256).max` full close branch, and simulate the call before sending so a `DeleverageTooDeep` or `DeleverageTooLarge` plan is resized instead of retried.
  - Done when: the protector never sends a plan the router refuses with `DeleverageTooDeep` or `DeleverageTooLarge`, with a test for a large reduction and a fill better than the oracle.
  - Note (20 November 2026): planned for 27 November, before the first Base weekly close (Friday 27 November, 20:00 New York time). Only routers built from the current `main` have `DELEVERAGE_FLOOR`; the live Monad router does not, so the protector acts only through routers that have it (BE-98).
  - Note (20 November 2026): done in BE-89 already: the protector takes each stock's decimals from `packages/shared` (Base stocks have 8) and skips a market whose oracle says `CLOSED`. The floor sizing above is still to do.
  - Note (20 November 2026, start here): `apps/keeper/test/protector.fork.test.ts` fails on a fresh deploy of `main`. With the QQQ oracle set to the DEX price, the protector sends both reductions but the LTV after does not land at `softLtv - TARGET_BELOW_SOFT_WAD` within 2 points. With the oracle 9% from the DEX it skipped both on "price deviation". The BE-89 changes leave Monad's numbers the same (decimals 6 and 18), so this is most likely the gap this task closes. Not compared on the old keeper code: anvil crashed on the public RPC's rate limit (HTTP 429).
  - Note (22 November 2026): done on `be/BE-88-keeper-floor` (D-105). The protector reads `DELEVERAGE_FLOOR` and `DELEVERAGE_SLACK_BPS` from the router (the live Monad router has neither and then gets no bound checks) and the market's Morpho price, and plans inside both bounds: no full close branch any more, a plan that would end within 0.5 point of the floor is skipped, and when the slippage alone would break the size bound the swap's `minOut` is raised as far as the quote allows (at least 10 bps under it), else skipped. Every plan is simulated first; a `DeleverageTooDeep` or `DeleverageTooLarge` there is logged and skipped, not sent. Tests: 16 unit tests (both bounds for long and short, a reduction of about half the position, a fill 1% better than the oracle, a raised `minOut`, a route that loses too much, the simulation check). The fork test passes on a fresh deploy of `main`: both reductions land between the target and 2 points under it. The earlier failure came from the fork's oracle, stale and `CLOSED` on a weekend; the test now posts the DEX mid price in the regular session first. The liquidator and alerts fork tests had the same stale price and now refresh it. Every keeper test passes on the fork (100).

- [x] **BE-89 · Liquidation bot leaves a margin for accrual**
  - Needs: the liquidator with `lossBudgetOf` (D-91).
  - Do: size the swap `minOut` from accrued Morpho totals (`expectedMarketBalances`) plus a small margin, so a liquidation does not end a few wei short and revert `LossTooLarge` while the loss budget is zero. Alert on `LossBudgetSet` and `LossBudgetSpent`. The keeper must not plan reductions while the session is `Closed` (`MarketClosed`).
  - Done when: a test shows a liquidation after interest accrual passes with a zero loss budget.
  - Note (20 November 2026): planned for 24 November, before Base goes live. The live Monad `Liquidator` has no loss budget: keep its current sizing until Monad gets a new liquidator, and choose the path by whether `lossBudgetOf` answers.
  - Note (20 November 2026, done early): D-99. The bot reads `Lens.getMarkets` (Morpho's `expectedMarketBalances`) for health and the seizure, and requires the swap to bring back `morphoRepaidCeiling` at the totals accrued 300 seconds further (`math.ts`, with `wTaylorCompounded` and `accrueBorrowAssets` matching Morpho). It still passes `minLoanTokenDelta` 0, so it never spends a budget the owner set. The monitor's `loss-budget:<token>` value alerts on every change of `lossBudgetOf`, which is what `LossBudgetSet` and `LossBudgetSpent` do. The protector skips a market whose oracle session is `CLOSED`. Also fixed: the short buy-back size and the protector's execution price used 18 decimal stocks, wrong for Base (8). Proven by `liquidator.fork.test.ts` on a fresh deploy of `main`: after 10 minutes of accrual, with `lossBudgetOf` 0, a long and a short liquidation pass and leave no tokens. Also by a property test in `liquidation.test.ts`: the ceiling holds for any accrual up to the margin, and the old sizing ends a wei short in some cases.

## M6. Launch

- [ ] **BE-60 · Production backend**
  - Needs: SC-60.
  - Do: a production environment separate from staging; production addresses; keepers with production keys.
  - Done when: all endpoints answer correctly against the production contracts; all keepers send a heartbeat.

- [x] **BE-61 · Status page**
  - Done when: the public can see the state of the oracle, keepers, API and indexer.
  - Note: written on 14 October 2026. The API serves `/status`: one plain HTML page with no script or outside files, built from `/v1/status`: each stock's oracle price age and limit, the keepers that run in this deployment, and the indexer lag, with one line saying whether all is normal. It refreshes every 30 seconds and answers 503 with a short notice when the chain cannot be read. Still to do: check it live on the staging API after merge, and give it the public status address once the domain is chosen (Q-25).
  - Note: done on 14 October 2026. Live at `https://api-production-c154.up.railway.app/status`: "All systems normal" with 13 green rows (three stocks, nine keepers, the indexer) and none red, after the keeper roles were granted and funded. Left for later: a status address on our own domain once Q-25 is decided.
  - Note (20 November 2026): the Railway address is gone. The page moves with the API to the VPS (BE-90) and shows each chain after BE-95.

---

## F. VPS and three-chain foundation

Added on 20 November 2026 with the execution plan at the top. These tasks replace Railway and give Base and X Layer the base they stand on.

- [~] **BE-90 · Backend on a VPS**
  - Needs: a VPS ordered by Dharu (rules in `docs/hosting.md`), D-94.
  - Do: a new `deploy/` folder: one image for the backend apps (`Dockerfile`), `compose.yml` with `postgres`, `migrate`, `api`, `indexer-monad`, `keeper-monad` and `caddy`, an entrypoint that loads one secret per file, an example env file per service, and `deploy.sh` (steps in `hosting.md`). Harden the server: SSH keys only, firewall open on 22, 80 and 443, Postgres without a public port, automatic security updates, Docker log rotation, every service back after a reboot. HTTPS through Caddy, on an interim address until the domain exists (Q-25). Set `APP_VERSION` to the commit, and `MONITOR_API_URL`, `CORS_ORIGINS` and `AUTH_DOMAIN` for the new setup. An outside uptime check on `/v1/health` and `/v1/status` that alerts the team (moved here from BE-15 and BE-50). Add `deploy/` to the ownership tables (CLAUDE.md, README, 06, CODEOWNERS) in the same PR.
  - Done when: `/v1/health`, `/v1/status` (indexer lag a few blocks, every Monad keeper healthy) and `/status` answer on the new HTTPS address; the deployed web app reads markets from it; a server reboot brings every service back by itself; one uptime alert reached the team on purpose; `hosting.md` says what was verified and when.
  - Note (20 November 2026): the `deploy/` files are written on `be/BE-90-vps` and the whole stack ran in a local copy against Monad mainnet (what was verified is in `hosting.md`). Still to do on 21 November: buy the VPS, run `setup-server.sh`, deploy, HTTPS, the reboot test, the uptime check, and send the address to Nabil.
  - Note (22 November 2026): live since 21 November at `https://api.levra.finance` (Let's Encrypt through Caddy). Checked from outside on 22 November: `/v1/health`, `/v1/status` (all nine Monad keeper jobs healthy, indexer a few blocks behind) and `/status` answer; only ports 22, 80 and 443 are open; SSH takes keys only, root is refused; CORS answers `app.levra.finance` and refuses other origins. The web app reads it (Wangsit, PROGRESS). Left for "Done when": the reboot test, the outside uptime check with one alert on purpose, and the verified list in `hosting.md`.
  - Note (20 November 2026): the VPS is at netcup and keeps its Debian 13 (D-101); `setup-server.sh` accepts it. The API address is `api.levra.finance` and the web app `app.levra.finance`, already in the env examples.

- [~] **BE-91 · Move data and keys off Railway**
  - Needs: BE-90 for the target. Step 1 does not wait.
  - Do: follow "Moving off Railway" in `hosting.md`. Step 1, right away: if the Railway project can still be read, dump the database and move the four Monad role keys straight into the VPS secret files, never printed. If not: an empty database, the indexer replays, the oracle recorder backfills to 29 September 2026, new Monad role keys are made on the VPS (BE-55), Wangsit moves the roles (`make set-roles-monad`), and the new wallets are funded. A new `AUTH_SECRET` either way. Check that the five Monad markets have no open borrow positions while the keepers were down.
  - Done when: the database is restored with matching row counts, or rebuilt with the indexer at the chain head and oracle data back to 29 September 2026; `verify:data` on the VPS reports every router, Morpho and vault event of the Monad deployment present and every position equal to Morpho's, with its traction table pasted in PROGRESS; every Monad role job holds its role and reports healthy; the path taken, and any role or top-up transaction hashes, are in PROGRESS.
  - Note (21 November 2026): keys path done. New Monad keys were made on the VPS instead of moving the old ones; all 49.91 MON on the old role wallets moved to them with `apps/keeper/scripts/sweep.ts`, Wangsit granted the new roles and removed the old keepers, and the Telegram bot token moved with `move-variables.ts`. All nine Monad keeper jobs report healthy (hashes in PROGRESS). The database was rebuilt by the indexer, not restored. Left for "Done when": run `verify:data` on the VPS and paste its traction table in PROGRESS.
  - Note (20 November 2026): Railway still opens but its services are stopped (plan limit reached), and the Railway CLI on Dharu's laptop is logged out. `apps/keeper/scripts/move-variables.ts` moves variables from Railway into the VPS secret files through `ssh`, never printed (`hosting.md` step 1). A database dump needs Railway's Postgres running again, so it is only worth paying for if the data that cannot be rebuilt matters (decision for Dharu).
  - Note (20 November 2026): Dharu asked that the transactions and traction reach the VPS in full. They are on chain, so they come back with or without the dump. `apps/indexer/src/verify-cli.ts` (`pnpm --filter @levra/indexer verify:data`) proves it after the move: it reads every event of our deployment again through the RPC endpoint, compares it with the database, checks each rebuilt position against `Morpho.position`, and prints events and wallets per type. `keeper-monad.env.example` now backfills 15,000,000 oracle blocks on the first start.

- [x] **BE-92 · Check the Base and X Layer limits against `math.ts`**
  - Needs: 04 "Base limits" (SC-74) and "X Layer limits" (SC-82). Blocker for Wangsit: both deployments wait for it.
  - Do: a test that recomputes every number in both tables with `math.ts`: maximum leverage from the soft limits (`maxLeverageE2`), the closed check after the worst gap (`ltvAfterGapWad`), and the bonus (`liquidationIncentiveFactorWad`). Check the price scale for 8 decimal stocks (Coinbase) and 18 decimal stocks (xStocks) against `ChainlinkSessionOracle.price()` on a fork, for long and short. An X Layer fork runs everything; on Base the oracle reads only the feed and the registry, which a fork can run, while B20 transfers cannot. Check `cautiousPriceE8` with the bid and ask the adapter reports, and `stockForUsd`, `swapPriceE8` and `liquidationPriceE8` at both decimal sizes.
  - Done when: the test reproduces both tables, or each difference is sent to Wangsit and 04 is corrected; the blocker row is closed and the `math.ts` check in SC-74 is met.
  - Note: done on 20 November 2026. `packages/shared/limits.test.ts` recomputes both tables with `math.ts` and finds no difference (leverage in 04 is the exact value rounded to one decimal; the API's `maxLeverageE2` gives two). The price scale was read live instead of on a fork of our own oracle, which is not deployed yet: Morpho's oracle for each of the twelve listed markets equals `morphoOraclePrice`, which uses the same `SCALE` as `ChainlinkSessionOracle`, at 8 and 18 decimals (05). `ChainlinkSessionOracle` reports no bid or ask, so `cautiousPriceE8` gives the feed price on both sides, as `price()` does. `stockForUsd`, `swapPriceE8` and `liquidationPriceE8` agree with each other at both decimal sizes.

- [x] **BE-93 · Gap table rows for the Base and X Layer stocks**
  - Needs: BE-34 (the `report:gaps` script). Blocker for Wangsit (SC-74).
  - Do: add MSFT, GOOGL, META, AMZN and SPCX to `gapTable` with `report:gaps`, over five years to 19 November 2026 as in 04. Compare the existing AAPL, TSLA, NVDA, SPY and QQQ rows with 04 (same code, newer window) and agree with Wangsit whether to refresh them. SPCX has only 23 weekend events since June 2026: a comment says so, and 04 uses NVDA's worst drop for its limits. Check that `gapScenarios` finds each stock by the symbol `markets.ts` uses on each chain.
  - Done when: `gapScenarios` gives rows that match 04 for every listed stock on Base and X Layer; the blocker row is closed.
  - Note: done on 20 November 2026. `report:gaps` takes new symbols on the command line and marks a stock with a short history. The table was rebuilt over November 2021 to November 2026 (274 events per stock): every worst drop and rise equals 04, both for the new rows and the old ones, so the old rows were refreshed too (only the "more than 2%" shares moved). `gapStandIns` gives SPCX NVDA's worst drop for a long, as 04 does for its limits, and the scenario label says so. Tests: a row for every stock on every chain by its `markets.ts` symbol, the closed checks of 04 for Base and X Layer, and SPCX.

- [~] **BE-94 · Second reader for the contract changes**
  - Needs: nothing. Blocker for Wangsit: 06 asks for a second reader before SC-87, SC-76 and SC-83.
  - Do: read the `MarginRouter` close without a fresh price (SC-86), the keeper floor and size bound (D-90 to D-93), the `Liquidator` loss budget, and `SwapTargets` with fixed spenders (D-79, D-88), against 03, 04 and the threat list in 07. Look hardest where the backend depends on them: keeper reductions, liquidation sizing, and the swap target and spender the API must use. Nabil can take the user paths of `MarginRouter` if the team splits the read.
  - Done when: Wangsit has the written notes (in the PR or under "Review notes" in PROGRESS), each finding is fixed or accepted, and the blocker row is closed.
  - Note (20 November 2026): read done, notes under "Review notes" in PROGRESS. No fund-safety bug in the contracts. One backend gap became BE-99; two deployment points, (3) a token as swap target and (4) the fixed OKX approve contract, wait for Wangsit's answer. Then the blocker row closes.

- [~] **BE-95 · Three chains in one backend: config and database**
  - Needs: SC-73 and SC-80 (both done). Route contract: D-60.
  - Do: each indexer and keeper process takes `CHAIN_ID` with that chain's RPC and deployment file; the API loads every chain that has a deployment, with one client and cache per chain. A migration adds `chain_id` to every table with chain data (events, oracle updates, DEX quotes, rates, transfers, cursors, heartbeats, monitor keys); Monad rows get 143; unique keys and indexes include it. Jobs that are not per chain (Telegram chat linking through `getUpdates`, the daily gap check, the public API check, cross-chain transfers) run in one keeper only (`KEEPER_GLOBAL=1`), because Telegram allows one update reader per bot. The monitor checks the gas token of each chain (MON, ETH, OKB; thresholds are initial proposals). `/v1/status` and `/status` show each chain. 03 section 7 gets the real variable names (today it lists `KEEPER_PRIVATE_KEY_*` and `ONECLICK_API_KEY`, which the code does not read) and the new chain variables, through the process in 06.
  - Done when: Monad on the VPS gives the same answers after the migration (tests); a second chain is switched on with env only; a replay from the start still gives the same rows.
  - Note (20 November 2026): code done on branch `be/BE-95-three-chains`, decision D-95. Migration 0008 tested on Postgres 17 with old rows (they become 143, a write without a chain is refused, the same transaction on two chains is two rows). Tests: indexer 14, keeper 57 (fork tests skipped), API 77, shared and db pass; typecheck of every package passes. A Base indexer or keeper starts with `CHAIN_ID=8453`, `RPC_URL` and a Base deployment file; before our Base deployment only the team monitor and alerts have work there. Left: run it on the VPS with the Monad data (BE-90) and check the answers match, then `[x]`.

- [x] **BE-96 · Swap provider interface and the Base providers**
  - Needs: D-53, D-80, BE-71 (done), a 1inch API key.
  - Do: a new `packages/swap` (owner Dharu, ownership rows in the same PR) with one interface: quote, calldata for a given sender and recipient, and the target and spender the router expects. KyberSwap moves behind it (`packages/kyber` is folded in) and also serves Base; the 1inch Swap API (plain User-Agent, 05); the Aero SwapRouter called directly and quoted through the Aero MetaQuoter. The API picks the best route among the providers whose router is in the deployment's `swapTargets()`, and falls back to the next one on an error. Each provider keeps its own request budget (BE-51). The DEX mid price (D-36) is measured per chain.
  - Done when: on Base, each provider returns a quote and calldata for every listed stock with a contract as sender and recipient (our router once SC-76 has deployed it), and the calldata delivers the quote in a live simulation (`eth_simulateV1`, since a fork cannot run B20 tokens, 07); Monad quotes are unchanged (tests).
  - Note (22 November 2026): step (4) done. The keeper's depth job takes a chain's stocks, oracle prices and USDC: Anchored on Monad as before; on Base the Chainlink feed answers scaled to 8 decimals, measured on the better of KyberSwap and Aero (`apps/keeper/src/dex/depth.ts`, `dex/swap.ts`). 1inch is left out of the keeper, since its one request per second is shared with the API's quotes. `keeper-base` now runs `marketDepth`, so `dex_quotes` gets Base rows and the API's markets show a Base DEX mid; X Layer waits for BE-81. Live run on 22 November 2026 into a test database: the full table for all 8 Base stocks, 88 rows, no failure, 62 seconds. Known: the API and both keepers call KyberSwap from the same VPS address; a 429 is recorded as a failed row and counted, not retried.
  - Note (22 November 2026): part 1 on `be/BE-96-swap-providers` (D-104). `packages/swap` holds the `SwapProvider` interface (`quote`, `price`, `target`, `spender`), KyberSwap (moved from `packages/kyber`, which now only re-exports it), 1inch, Aero (pool per tick spacing, quoted by the MetaQuoter), `bestRoute` (asks every provider, keeps the largest output, skips one that fails) and the DEX mid price. Each provider has its own request spacing and 429 retry. Tests: swap 29, API 58 and keeper 46 unchanged (DB tests run in CI). Live on Base: KyberSwap and Aero quote all 8 stocks (05). Left, after #103 (BE-70) merges: (1) move the API and keeper imports to `@levra/swap` and delete `packages/kyber`; (2) build the providers per chain from the deployment's swap targets and wire `bestRoute` into the Base quotes, with the keys from the VPS (`ONEINCH_API_KEY` is there since 22 November); (3) the `eth_simulateV1` check of each provider's calldata; (4) the mid price per chain.
  - Note (22 November 2026): step (1) done. The API and keeper import `@levra/swap`; `packages/kyber` is deleted, with its rows in CODEOWNERS, CLAUDE.md, 06 and the README. Next: step (2).
  - Note (22 November 2026): step (2) done. `apps/api/src/chain/swap.ts` lists the providers of each chain (KyberSwap on Monad; KyberSwap, Aero and, with `ONEINCH_API_KEY`, 1inch on Base; none on X Layer until BE-81) and keeps only those whose target and spender the router lists in `swapTargets()` and `swapSpender()`, read on first use; `bestRoute` picks among them. Each HTTP provider has its own budget (1inch 50 a minute, initial proposal). `/v1/8453/quote/*` is now served. Live on Base (22 November 2026, without the 1inch key): the router allows KyberSwap and Aero, and the best route answers for all 8 stocks at 100 USDC (KyberSwap wins six, Aero GOOGL and TSLA). Monad still quotes through KyberSwap via the new router's list. The quotes themselves on Base are not verified yet (BE-72, step 3). Left: (3) the `eth_simulateV1` check of each provider's calldata; (4) the mid price per chain. Deploy: write `ONEINCH_API_KEY` into `/opt/levra/secrets/api/` on the VPS.
  - Note (22 November 2026): step (3) for KyberSwap and Aero. `packages/swap/test/base-live.test.ts` (skipped unless `BASE_LIVE=1`; 1inch joins with `ONEINCH_API_KEY`) builds a buy and a sell of every Base stock with our Base router as sender and recipient and runs them in `eth_simulateV1` on the live node: 16 of 16 pass, each delivering at least the quote less 1% (numbers in 05). Left for "Done when": the same run with the 1inch key, and step (4), the mid price per chain.
  - Note (23 November 2026): done. With the 1inch key on the VPS, 1inch and Aero deliver their quotes for all 8 stocks (1inch within 1 bp); KyberSwap passed all 8 from another machine, while on the VPS 4 failed in a row, most likely its rate limit (not verified, numbers in 05). Step (4) was done on 22 November.

- [~] **BE-97 · Chainlink price recorder for Base and X Layer**
  - Needs: BE-95, SC-72 (done), the feeds in `markets.ts` (done). Does not wait for our deployments.
  - Do: the oracle recorder learns Chainlink feeds. Read `AnswerUpdated` from the aggregator behind each feed (check per feed whether the `priceFeed` address is a proxy; read `aggregator()` again when the phase changes), and store price, round and `updatedAt` per chain in `oracle_updates`, with bid, ask and session empty. Backfill the last weeks from logs. Run it on the VPS as `keeper-base` and `keeper-xlayer` with no keys, before 26 November. Price history (BE-24) works per chain. After Thanksgiving week and a weekly freeze, generate the BE-03 style report for these feeds.
  - Done when: both chains record without gaps from before 26 November; the report on the weekly freeze and on Thanksgiving (26 and 27 November) is in 05 and used by BE-30; 1D charts answer for Base and X Layer stocks.
  - Note (20 November 2026): recorder done on `be/BE-97-chainlink-recorder` (D-97). It reads rounds with `getRoundData` instead of logs, because the public Base RPC refused `eth_getLogs` and X Layer's allows about 100 blocks. `keeper-base` and `keeper-xlayer` are in `deploy/compose.yml` with env examples; they need no key. Run live against both chains into an empty database: every round from 23 October to 20 November 2026 with no gap (Base 4,177 rounds, X Layer 39,994), then both stayed current; `oraclePriceSeries` answers a 1D series for both chains. Left: run it on the VPS on 21 November so the record starts there before Thanksgiving, the route per chain for the 1D chart (BE-70), and the freeze report after 27 November.

- [x] **BE-98 · Follow the new Monad router (SC-87)**
  - Needs: SC-87, BE-95.
  - Do: the indexer reads `router` and every address in `previousRouters` (03 section 6); history, entry price and PnL merge the events of all routers; quotes target the new router and ask for the Morpho authorization of the new router. The protector acts only through a router that has `DELEVERAGE_FLOOR` and only for opt-ins made on it (users opt in again, 03), since the live router has no keeper floor. Send the protector address to Wangsit for the keeper role on the new router. The liquidator bot keeps working with the old `Liquidator` until Monad gets a new one.
  - Done when: on a fork with the SC-87 script, a position opened on the old router and closed on the new one shows as one history; the protector ignores opt-ins on the old router; the blocker row is closed.
  - Note (22 November 2026): done. The code came with BE-100, BE-88 and BE-99; `apps/api/test/router-change.fork.test.ts` proves it on a fork. It deploys the replacement router and Lens from the forge build with the same steps as `RedeployRouter.s.sol` (the old router's targets, spenders and fees), not by running the script itself. A QQQ long opened through the API on the old router, with protection on there, is closed through the API on the new router: the close quote first asks for the Morpho authorization of the new router (gas limit 0), and after the user's `setAuthorization`, as the web app does, it closes. The indexer, on the new cursor, stores the open under the old router and the close under the new one; the history is one position, close then open, with the realized PnL against the margin of the open, and the chain-only store gives the same items. The opt-in on the old router does not count for the new one. On Monad mainnet (read 22 November 2026): the new router `0xf558...aA88` has `DELEVERAGE_FLOOR` (5e16) and the protector key `0x469a...f474` is its keeper, so the protector acts there. The liquidator bot keeps the old `Liquidator`. Left for the VPS: deploy `main`, so the indexer reads the new deployment file and rescans both routers (BE-100 note).

- [x] **BE-99 · Close quotes without an oracle price**
  - Needs: SC-86 in the router being quoted (the Base and X Layer routers, and Monad after SC-87).
  - Do: when a market's oracle cannot be read (Lens price 0, from a `snapshot()` revert), `quote/close` still returns a full close: repay all debt, withdraw all collateral, the swap sized from the debt and the DEX quote alone, `minOut` from the DEX quote and the user's slippage, no deviation check against the oracle, and a clear flag in the answer that the oracle price is missing. A partial reduce or a collateral withdrawal without a price stays refused, as the router refuses it. The account and market routes show the market as without a price instead of failing. Only for routers with SC-86; on the live Monad router the API keeps refusing, since that router would revert.
  - Done when: a fork test with an oracle whose `snapshot()` reverts gets a full close quote from the API and the transaction closes the position through the router; a partial reduce is refused with a clear error; every route that reads that market answers. Found in BE-94 (Known issues).
  - Note (20 November 2026, done early): D-100 and 03 section 4 "A market without an oracle price". `oraclePriceE8` `"0"` is the flag (no schema change). The API reads `DELEVERAGE_FLOOR()` once per router to know it has SC-86. Proven by `apps/api/test/close-no-price.fork.test.ts` on a fresh deploy of `main`, with Anchored's oracle made to revert (Anchored refuses a price of zero or below, so a revert is the real failure): markets, market detail and account answer, a collateral add quotes, an open and a half close get 400, and a long and a short close in full through the router. The live Monad router is read as without SC-86. Built on BE-70, so the PR follows it.

- [~] **BE-100 · Read every router after a router change**
  - Needs: nothing to start; SC-87 uses it. Asked by Wangsit on 22 November 2026.
  - Do: before the Monad router is replaced (SC-87), make the backend read `router` and every `previousRouters` address (03 section 6): the indexer indexes the events of all of them into `router_events`, recording which router emitted each one, and catches up the new router from the deployment block once the list changes; the API's account history without a database reads all of them too. The protector takes its candidates only from `ProtectionSet` events of the current router, since opt-in does not move to a new router (03 section 6), and the chain check stays on the current router.
  - Done when: with a deployment file that has a second router, a test shows the indexer storing both routers' events with their router, the protector ignoring an opt-in made on the old router, and the account history holding positions from both; the monitor and `/v1/status` watch the right indexer cursor.
  - Note (22 November 2026): written. `router_events` has a `router` column (migration 0010). The router stream reads `[router, ...previousRouters]` in one query (RPC and HyperSync both take a list); `routerCursor()` in `packages/db` names the cursor `router_events` with one router and `router_events:<n>` with n routers, so adding a router rescans every router from the deployment block (about 1,100 RPC pages on Monad today), and that rescan only fills `router` on rows indexed before the column. The protector's candidates come from `ProtectionSet` events of the current router only; rows without a router count only while there is no previous router. The account history without a database reads every router. The monitor and `/v1/status` use `routerCursor()`. Tests with the test database: both routers' events land with their router, including the new router's events from before the indexer saw the new file, and only the new router's opt-in counts. Every keeper test passes on a fresh fork (107). Done once SC-87 ships the deployment file and the indexer runs it.

- [x] **BE-101 · PnL in percent**
  - Needs: nothing. Asked by Nabil on 20 November 2026 for the share card (FE-76).
  - Do: one formula for a position's PnL in percent in `math.ts`, and the value on `Position`.
  - Done when: `/v1/accounts/:address` returns it, with tests by hand.
  - Note (23 November 2026): `pnlBps(pnl, invested)` in `math.ts` (signed bps, rounded toward zero, null without margin put in) and `Position.pnlBps` (03). The base is the margin still in the position, the same one as `unrealizedPnlUsdRaw`. Tests: the formula, and an account at +20% and -20%, plus null for a Morpho-only position and a market without a price. Optional in the schema so the web app's fixtures still type-check.

---

## B. Base (Stocks Maxxing)

Plan and reasons: [11-base-stocksmaxxing.md](../11-base-stocksmaxxing.md). Deadline for the submission: 5 December 2026.

- [~] **BE-70 · Chain in every API route**
  - Do: propose `/v1/:chainId/...` (or another shape) in 03 first, through the process in 06. Keep the current routes as Monad aliases until FE moves.
  - Done when: 03 updated and agreed, routes serve Monad under the new shape.
  - Note (20 November 2026), what the 03 proposal covers: the routes that take the chain (`config`, `session`, `markets`, `markets/:symbol`, `markets/:symbol/prices`, `stream`, `quote/*`, `accounts/:address`, `accounts/:address/history`, `earn`, `earn/:address`, later `stats`, `proofs` and the agent routes) and the ones that stay global (`health`, `status`, `/status`, `eligibility`, `terms/accept`, `auth/*`, `alerts*`, `deposit/tokens`); the deposit and withdrawal quotes name their destination or source chain; sign-in accepts chains 143, 8453 and 196 (D-38 names 143 only); new `Market` fields for Base and X Layer: the oracle kind (Anchored or Chainlink), the B20 UI multiplier (WAD), feed frozen and token paused. The short capacity FE-72 needs is the existing `availableLiquidityRaw` of the short market. All are additions, so the current routes keep working as Monad aliases. Serving more than Monad needs BE-95.
  - Note (20 November 2026, later): proposed and built the same day as additions (D-102, 03 section 4). `/v1/:chainId/...` serves every chain whose deployment file is loaded; `GET /v1/chains` lists the live ones; sign-in accepts any live chain and checks the signature there; `Market` carries `oracleKind`, `uiMultiplierWad` and `tokenPaused` (Base reads the last two from the Coinbase registry). While building it, accounts, Earn, collateral quotes and the Morpho authorization typed data were found to use Monad's Morpho, USDC and an 18 decimal stock even for another chain; they now read their own chain's. Deposit and withdrawal quotes stay global for Monad until BE-76. Left: Nabil's review (the "Done when" asks for agreement), then FE-70. Base data through these routes is not verified until SC-76 gives a Base deployment file (the Lens and oracle reads on Base are untested).

- [x] **BE-71 · Swap providers: 1inch and Aerodrome**
  - Owner for this task: Wangsit, agreed with Dharu on 19 November 2026. Results go to 05 and are handed to Dharu for BE-72.
  - Note: started on 19 November 2026. The deepest stock pools are in Aero (the Aerodrome and Velodrome merger), not in the pre-merger Aerodrome factories; the Base swap targets are now 1inch, KyberSwap and the Aero SwapRouter (D-80, 05). All three pass the B20 policy and a simulated pull for every stock. Finished the same day: 1inch quotes for all 8 stocks at $100, $1,000 and $10,000, built swaps with a contract as sender and receiver that deliver the exact quote in a live simulation, and the Monad check (1inch cannot route aBIL, so KyberSwap stays, D-81). All in 05. A KyberSwap quote on Base is left for BE-72, since the KyberSwap API key is still a blocker (BE-04). For BE-72: send a plain User-Agent to the 1inch API, and expect 450,000 to 565,000 gas per swap.
  - Do: the provider choice is made (D-72): 1inch Swap API primary and the Aerodrome router as fallback on Base, 0x dropped. Prove it: on Base, quote and build a 1inch swap and an Aerodrome swap for each stock with our router as sender and recipient; measure price and rate limits. On Monad, check whether 1inch routes Anchored tokens; until it does, KyberSwap stays.
  - Done when: results in 05, router addresses sent to Wangsit (SC-75), and the Monad choice recorded in 09.

- [~] **BE-72 · Quotes on Base**
  - Needs: BE-70, BE-71, BE-95, BE-96, SC-73; SC-76 for the final test.
  - Do: long, short, close and Earn quotes on Base with the chosen aggregator. B20 amounts stay raw; UI share amounts use the multiplier.
  - Done when: quotes match a live simulation (`eth_simulateV1`) within the stated tolerance. A local fork cannot run B20 tokens (SC-71, 07), so a fork execution is not possible on Base.
  - Note (20 November 2026): long first (25 November), then short and the Earn data (28 November). Earn on Base is our USDC vault and stock supply to our short markets (D-77); the web app builds the Earn transactions itself (D-07).
  - Note (23 November 2026): `apps/api/test/base-quotes.live.test.ts` (`BASE_LIVE=1`) runs the API on a virtual Base: its reads and gas estimates run in `eth_simulateV1` after setup calls, pinned to one block. Long, short and full close quotes for SPCX execute with the quoted calldata and gas limit and match the preview within 1 bp; the router ends empty; Earn shows a market supply and a vault deposit exactly. No API change was needed. Results in 05. Left: the final run after SC-76 against the finished Base deployment, the other stocks on a weekday (`BASE_LIVE_STOCK`), and 1inch with `ONEINCH_API_KEY`.
  - Note (23 November 2026, later): all 8 stocks run on a weekday, with 1inch competing, on the VPS. Long, short, close and Earn pass for every stock, within 8 bps of the preview. The short and Earn cases of AMZN, META, MSFT and TSLA first failed in the test's setup, because Morpho holds less than 5 of those shares; the test now takes the stock from its largest holder (Morpho or an Aero pool). Results in 05. Left: the final run after SC-76.

- [ ] **BE-73 · Indexer and keeper on Base**
  - Needs: SC-72, SC-76.
  - Do: run indexer and keeper per chain from config. Index `UIMultiplierUpdated`, `UIMultiplierUpdateCancelled`, `Announcement`, `EndAnnouncement` and the oracle adapter events. Liquidator bot and auto-deleverage on Base. Never act on a frozen feed.
  - Done when: both run on the VPS against Base mainnet and a test position shows in the API.
  - Note (20 November 2026): the Chainlink price recorder starts earlier as BE-97; the calendar rule for Chainlink chains is in BE-30; the keeper addresses go to Wangsit before SC-76 (BE-55). BE-88 and BE-89 must be done before the keeper acts on Base.

- [~] **BE-74 · Builder Codes**
  - Do: attach Levra's Builder Code to every Base transaction the API builds.
  - Done when: a real transaction shows the code in Base's attribution.
  - Note (20 November 2026): the code goes on every Base transaction the API builds. The constant lives in `packages/shared/api`, so the web app adds the same code to the Base transactions it builds itself (Earn, D-07). First check how Base links a transaction to a Builder Code (not verified). Needed before the first real Base transaction, since traction counts from it.
  - Note (23 November 2026): how Base links a transaction to a code is now checked against Base's docs: an ERC-8021 suffix at the end of the calldata (D-108). `packages/shared/api/attribution.ts` writes it (tested byte for byte against `ox/erc8021`), and all five API quotes append it on Base before the gas simulation. A live simulation with a test code ran Base long and short, open and close, through our router. Left: Levra's code from base.dev into `builderCodes[8453]` (one line), then a real Base transaction checked on base.dev. FE-93 does the same for the web app's own Base transactions.
  - Note (23 November 2026, later): the code is `bc_1w63m4n4`, from the Levra project on the Base Dashboard (dashboard.base.org; Base's docs moved it there from base.dev), now in `builderCodes[8453]`, with a test that reads it back on Base and finds nothing on Monad or X Layer. Left: deploy, then a real Base transaction checked on the Base Dashboard.

- [x] **BE-75 · Policy and pause monitor**
  - Do: watch each listed token's policy and pause state; alert the team and the affected users (Telegram) when it changes; mark the market halted in the API.
  - Done when: a fork test that flips a pause raises the alert.
  - Note (20 November 2026): covers X Layer too. D-86: on X Layer the keeper catches a token pause or a sanctions list change and alerts, and the guardian pauses opening.
  - Note (22 November 2026): the team part is written in the monitor (`apps/keeper/src/monitor/gates.ts`). Every minute it reads, for Morpho and our router and liquidator when deployed: on Monad Anchored's compliance denylist and Circle's USDC pause and blacklist; on Base each stock's B20 transfer pause, the Coinbase oracle registry pause and whether each transfer policy still authorizes the account; on X Layer the wrapped and underlying xStock pause and the sanctions list. A block alerts at once and resolves when lifted; a control that cannot be read alerts after 5 minutes. Fork test: denylisting Morpho on the Monad fork raises the alert and lifting it resolves it. Live read on 22 November 2026: 17 controls on Base and 9 on X Layer, all readable, none blocking. The ABIs are inline until `packages/shared/abis` has them (SC-88). After Wangsit's review of #111, Circle's USDC pause and blacklist are read on every chain, and the blacklist also for the Earn vault (a blacklisted vault locks the lenders' USDC); fork test: blacklisting the router for USDC raises the alert. Live read with the real deployments on 22 November 2026: 8 controls on Monad, 24 on Base, 15 on X Layer, all readable, none blocking. The deployment files for Base and X Layer now exist, so the monitor covers them once their keepers run (BE-73, BE-80). Still to do: alert the affected users and mark the market halted in the API.
  - Note (22 November 2026): done. The API marks a market halted with `Market.haltReasons` (#118). The alerts keeper sends each wallet with a channel one alert per block when a control blocks a stock it holds (collateral or debt), or the whole chain (also USDC lent in Earn), and one more when the block is lifted; a block that comes back alerts again. A control that cannot be read is not taken as lifted. No event switch: a halt can stop a close (D-107). Fork test: pausing a held stock alerts both holders once, a stock nobody holds alerts no one, lifting it sends one "lifted" each, an unreadable control holds the "lifted" back, and a USDC pause reaches every holder. After SC-88 the monitor, the calendar poster, the protector (`isKeeper`, Morpho oracle `price`) and the API's Earn reads use `packages/shared/abis`; a live read on 22 November 2026 with them found 24 controls on Base and 15 on X Layer, all readable, none blocking. Two inline ABIs stay because the export has no such entries: the token permit `name` and `version` (API reader) and the Chainlink proxy `getRoundData` (keeper oracle history).

- [ ] **BE-76 · Cross-chain deposits through CCTP and Across**
  - Do: replace Aurora Intents / 1Click (D-50) for deposits and withdrawals on both chains. Gas top-up on Base is not needed if the paymaster covers it (Q-34).
  - Done when: a real deposit from another chain into Base and into Monad, hashes in PROGRESS.
  - Note (20 November 2026): planned after the submissions, from 7 December. Until then the 1Click routes stay up on Monad (BE-40).
  - Note (24 November 2026): the CCTP half is built in BE-85 for every live chain (D-110). Left here: Across (Monad only, since Across does not list X Layer), the arrival alert, retiring the 1Click routes, and the real deposits into Base and Monad.

- [~] **BE-77 · Agent API and MCP server**
  - Do: read and prepare endpoints for the agent (positions, health, quotes, prepared transactions) and an MCP server that wraps them. No keys held. Shape written in 03.
  - Done when: an agent session can read a real position and prepare a close that a wallet signs.
  - Note (20 November 2026), proposal for 03: `POST /v1/:chainId/agent/prepare` stores a prepared action and returns an id and a link; the web app loads `GET /v1/prepared/:id` and asks the wallet to sign (FE-77). The MCP server is a new `apps/agent` that holds no keys.
  - Note (24 November 2026): built (D-111). API: `POST /v1/:chainId/agent/prepare` and `GET /v1/prepared/:id`, table `prepared_actions` (migration 0011), counted as a quote in the rate limit. `apps/agent`: 11 MCP tools over stdio and stateless Streamable HTTP, quote answers without `tx`; tested with a real MCP client in memory and over HTTP, and the prepare routes against Postgres. Deploy: `agent` service in `compose.yml`, `/mcp` in the Caddyfile, `deploy/env/agent.env.example`, `WEB_APP_URL` in api.env. Left: Nabil's review of the 03 section and FE-77 (the `/prepared/:id` page), then on the VPS create `agent.env` and set `WEB_APP_URL`, deploy, and do the "Done when" run: read a real position from an MCP client and sign a prepared close in the app.

- [ ] **BE-78 · Bankr and Telegram agent**
  - Needs: BE-77.
  - Do: ship the Levra agent in Bankr (skill or integration, check with Bankr's Telegram group) and in the BE-33 Telegram bot. Commands: position, quote, open, close, add collateral, alerts.
  - Done when: a real user flow works end to end from chat, recorded for the demo.
  - Note (20 November 2026): Telegram allows one update reader per bot, so the bot's updates move from the keeper to `apps/agent`, and the keeper only sends messages. P2: only if time allows before 4 December.

- [~] **BE-79 · Public stats endpoint**
  - Needs: BE-73.
  - Do: `GET /v1/stats` per chain: wallets, open interest long and short, volume, Earn supplied. Only indexed data.
  - Done when: FE-75 reads it.
  - Note (23 November 2026): built. `GET /v1/:chainId/stats` (and `/v1/stats` for Monad), schema `statsResponse` in `packages/shared/api/stats.ts`, definitions in 03 and D-109 (debt and lent amounts come from chain reads, since shares need the market totals). Queries `marketTrades` and `walletCounts` in `packages/db`, tested against Postgres; the numbers checked by hand in `apps/api/test/stats.test.ts`. Served on every chain the indexer covers: Monad now, Base after BE-73. Left: FE-75 reads it.


---

## X. X Layer (TapeOut Accelerate)

Plan and reasons: [12-xlayer-tapeout.md](../12-xlayer-tapeout.md). Deadline for the submission: 7 December 2026, 23:59 UTC.

- [ ] **BE-80 · X Layer in the API, indexer and keeper**
  - Needs: BE-70, SC-80, SC-83.
  - Do: serve chain 196 under the chain routes; run the indexer and keeper for X Layer; liquidator bot and auto-deleverage there.
  - Done when: a test position on X Layer shows in the API and the keeper runs on the VPS.
  - Note (20 November 2026): needs BE-95 and BE-81 too. The recorder for the xStocks feeds starts earlier (BE-97). Earn on X Layer is direct supply to our markets (`market:<id>` options, D-84), so it needs no vault code.

- [x] **BE-81 · OKX DEX API spike and swap provider**
  - Do: quote and build swaps for each wrapped xStock with a contract sender and recipient; measure price, depth and rate limits; check 1inch on X Layer too. Put the provider behind the shared aggregator interface (D-53).
  - Done when: results in 05, router address sent to Wangsit (SC-83), long and short quotes work on X Layer.
  - Note from Wangsit (20 November 2026, SC-82 and SC-83): the v6 API works on chain 196 with key, secret and passphrase, no project ID (v5 is retired). Our ISPs (XL, Telkomsel) redirect `web3.okx.com` by DNS; resolve it through 1.1.1.1 or call from a server. Send a plain User-Agent. The swap `tx.to` is the router `0x7c5b...AEaF`, but tokens must be approved to `0x8b77...F000`; our contracts handle that since D-88. Swap costs per size are in 05, and `make xlayer-fork-e2e` runs a long and a short through OKX on a fork.
  - Note (20 November 2026): split with BE-96. This task adds the OKX DEX API (v6, key, secret and passphrase) and the Uniswap v3 router (D-85) as providers behind the BE-96 interface. Calls go from the VPS, which avoids the ISP DNS block.
  - Note (23 November 2026): `packages/swap` has `createOkx` (signed v6 requests, router and approve contract checked) and `createUniswapV3` (QuoterV2 per fee tier, `exactInputSingle` on SwapRouter02), with unit tests. The API quotes X Layer through OKX when the three `OKX_*` secrets are set (on the VPS since 21 November). `packages/swap/test/xlayer-fork.test.ts` runs each provider's buy and sell by our router on an anvil fork (no `eth_simulateV1` on X Layer): Uniswap delivers its quote exactly for wQQQx and wGOOGLx, the only stocks with a Uniswap USDC pool (05). Left: (1) Wangsit adds QuoterV2 to `xlayerExternal`, then the Uniswap fallback joins the API; (2) the fork run with the OKX keys on the VPS; (3) long and short quotes through the API on an X Layer fork; (4) the keeper's depth job on X Layer. The router address went to Wangsit with SC-83 (done).
  - Note (23 November 2026): step (2) done on the VPS. OKX delivers its quote within 5 bps for wNVDAx, wQQQx and wSPYx, both ways; Uniswap exact for wQQQx and wGOOGLx. OKX wGOOGLx reverts on the fork with `StalePrices()` from its JIT Router venue, most likely a fork artifact (05); Uniswap covers wGOOGLx once it joins the API. Left: (1), (3) and (4).
  - Note (23 November 2026): step (3) started. `apps/api/test/xlayer-quotes.fork.test.ts` runs the API's long and short quotes and closes on an X Layer fork. With Uniswap only, wQQQx long and short open and close exactly at the preview (05). Left for (3): the same run with the OKX keys on the VPS for wNVDAx.
  - Note (23 November 2026): step (1) done. Wangsit added `xlayerExternal.uniswapQuoterV2`; `swapProviders(196)` lists Uniswap always and OKX first with its keys, and the Uniswap provider reads its factory from SwapRouter02. Left: (3) the OKX run on the VPS, (4) the keeper's depth job on X Layer.
  - Note (23 November 2026): OKX run on the VPS for wNVDAx: short open (-9 bps) and close (0 bps) pass. The long failed on `DeadlineExpired`, most likely because the first quote on a cold fork took longer than the 120 s deadline (05); the test now warms the fork first. Left for (3): the wNVDAx long.
  - Note (23 November 2026): step (3) as far as a fork allows. The cold fork's first quote took 189 to 192 s on the VPS (cause confirmed). The wNVDAx long then answered `HIGH_DEVIATION` three times: the fork freezes the feed while OKX quotes a market that moved about +16% that hour; production previewed the same long inside the 2% limit (05). Verified: Uniswap long and short (wQQQx), OKX short (wNVDAx), OKX buy and sell calldata (all four stocks but wGOOGLx). Not verified: an OKX long end to end, which needs USDC in our X Layer markets (seed funds) for a real transaction. Left: (4) the keeper's depth job on X Layer.
  - Note (23 November 2026): step (4) built. The X Layer keeper's depth job measures the better of OKX and Uniswap (`apps/keeper/src/dex/swap.ts`), OKX spaced 3 s apart; without the OKX keys it measures Uniswap only and logs a warning. Live check with Uniswap only: wQQQx sound, wNVDAx and wSPYx no route, the wGOOGLx pool mispriced 44.7% under the feed (05), so `keeper-xlayer` needs copies of the API's three `OKX_*` secrets. Left: copy them on the VPS, deploy, and read the first X Layer rows of `dex_quotes`.
  - Note (23 November 2026): done. Deployed `8b7226c` with the OKX secrets in `keeper-xlayer`; the first X Layer depth run finished at 14:41 UTC and `/v1/196/markets` shows a DEX mid for all four stocks within 77 bps of the feed (05). Results are in 05, the router address went with SC-83, and long and short quotes work on X Layer: through Uniswap end to end on a fork, through OKX for the short on a fork and for the long as a production preview. The first real X Layer long and short through OKX are SC-84 (Wangsit, after the seed funds of X-35).

- [~] **BE-82 · TapeOut spike**
  - Do: with TapeKit, deploy or reuse a processor on X Layer, tape out a small circuit, call it, and send one message through TapeSend. Record addresses, costs and limits. First answer Q-40: does a tape out need FabX transistors, and can we get them? If not, raise it to the team the same day, since it blocks BE-83 and BE-86.
  - Note: research on 19 November 2026 (05, TapeOut transistors): FAB-Genesis transistors are sold out; OrderGuard has 9,215 left at 0.0001 OKB each. Still to do: buy enough early, check whether our own processor via the factory gets its own supply, and measure the gate count of the risk and clock circuits.
  - Note (23 November 2026): Q-40 answered, our own processor works. `packages/tapeout` holds the netlist builder (NAND gates, local simulation, bit packing) and the chain calls (processor, mint, tape out, `eval`, container, TapeSend). The fork run in `test/xlayer-fork.test.ts` passes end to end with an 8-bit `a < b` circuit (05). Found on the way: since 8 November 2026 the factory and the new transistor contracts take BEM, not OKB. Left: the mainnet run from a funded key on the VPS (about 0.15 OKB and 0.2 BEM), which needs the TapeOut addresses in `xlayerExternal` (Wangsit, PROGRESS blocker), then the addresses, hashes and circuit ID in 05.
  - Note (23 November 2026): Wangsit added the TapeOut addresses to `xlayerExternal` (blocker closed); the fork test reads them. Left: the funded key (about 0.15 OKB and 0.2 BEM, more if the clock of BE-86 is taped out with it: 4,850 NAND cost only the 0.01 BEM mint fee at mint price 0) and the mainnet run. Paused by Dharu on 23 November 2026.
  - Done when: findings in 05 and the circuit and message are readable onchain.

- [~] **BE-83 · Risk circuit**
  - Needs: BE-82.
  - Do: health factor, liquidation price and session limit from `math.ts` as a TapeOut circuit. A test compares its output with `math.ts` on many inputs. The API and the agent show the circuit result next to ours and flag any difference. The circuit answers for any Morpho xStocks borrower on X Layer, not only Levra users (D-66).
  - Done when: the test passes and the agent answers "my health" with the circuit result.
  - Note (24 November 2026): circuit built and tested without waiting for BE-82 (D-112). `riskCircuit(limits)` in `packages/tapeout/src/risk.ts`: healthy, closed regime, and at or under each soft limit, exact against `math.ts` and `morphoIsHealthy` in the unit test; 8,522 NAND for aQQQ, taped out and read onchain on the X Layer fork (05). Liquidation price and a numeric health factor are not in the circuit (a full division is too large); they stay in `math.ts`. Left: tape out on mainnet with the BE-82 processor (one circuit per limit set on X Layer, plus the Morpho xStocks LLTVs), the circuit IDs in 05 and 03 (interface change with Nabil), then the API and the agent (BE-77) show the circuit answer next to ours and flag a difference.

- [ ] **BE-84 · PnL proofs through TapeSend**
  - Needs: BE-82, BE-80.
  - Do: on every closed position on X Layer, post a commitment (market, side, entry, exit, PnL percent, close transaction hash) through TapeSend from a keeper key. Expose `GET /v1/:chainId/proofs/:positionId`. Shape written in 03.
  - Done when: a real close produces a proof that FE-81 can verify.
  - Note (20 November 2026): D-87 extends the proofs to closes on every chain. They are posted from their own funded key on X Layer (one more key in BE-55), and Levra pays the OKB.

- [~] **BE-85 · CCTP deposits into X Layer**
  - Needs: BE-76.
  - Do: deposits and withdrawals for X Layer through CCTP V2 with native USDC.
  - Done when: a real deposit from another chain into X Layer, hash in PROGRESS.
  - Note (24 November 2026): built without waiting for BE-76, since CCTP does not depend on the 1Click work (D-110). New `packages/cctp` (Circle's contracts and domains, the Iris client, the burn plan and the status reader) and `/v1/:chainId/bridge/chains`, `bridge/deposit`, `bridge/withdraw` and `/v1/bridge/status` (03). The burn carries the Forwarding Service hook, so Circle mints on X Layer and the user needs no OKB. Fork test: a 5 USDC burn from X Layer to Base with the planned calls passes on Circle's real contracts (05). The routes serve every live chain, so the CCTP half of BE-76 is done too. The rate limit now counts paths with a chain ID like the Monad ones (quotes on Base and X Layer were not counted as quotes before). Left: FE-94 (Nabil), then a real deposit of a few USDC from Base into X Layer and its hashes and time in PROGRESS and 05.

- [~] **BE-86 · Wall Street Clock circuit**
  - Needs: BE-82.
  - Do: the market sessions from `calendar.ts` (regular, pre, after, overnight, weekend, holiday) as a TapeOut circuit on X Layer that any app can read (D-66). A test compares it with `calendar.ts` across a year of times, including holidays and daylight saving changes. Soft layer only: no contract and no hard limit reads it.
  - Done when: the test passes, the circuit address and ID are in 05 and 03, and the agent and the stats page read it.
  - Note (23 November 2026): circuit built and tested without waiting for BE-82. `wallStreetClock(2026, 2030)` in `packages/tapeout/src/clock.ts`, 4,850 NAND, built from `calendar.ts`; `clockAt` is the same rules on `calendar.ts` and the test compares the two over five years and around every holiday, early close and daylight saving change. On the fork it tapes out (14.1 million gas) and `eval` (11.2 million gas) matches `calendar.ts` onchain (05). Left: tape out on mainnet with the BE-82 processor, the circuit ID in 05 and 03 (interface change with Nabil for the stats page), then the agent (BE-77) and the stats page read it. The holiday evening overnight session and the 17:00 end of after-hours on an early close are initial proposals (05).

- [ ] **BE-87 · Agent checked by circuits**
  - Needs: BE-83, BE-86, BE-77.
  - Do: before the agent offers a long, short, close or add-collateral action on X Layer, it checks the action against the risk circuit and the clock circuit and shows the result. The user still signs and the contracts check again (D-66). Only if time allows before 3 December 2026.
  - Done when: the agent shows a circuit check on each prepared action on X Layer.
  - Note (20 November 2026): not planned for this round (execution plan at the top): no room before 3 December.
