# Progress

One place to see where the build stands. Task checkboxes live in the task files. This file holds the milestones, blockers, checkpoint results, real transactions and the daily log.

Last updated: 13 October 2026

## How to update

- Tick tasks in your own task file, in the same PR as the work.
- Edit only your own rows and your own log entries here, so three people can edit this file without conflicts.
- Write a blocker the same day it appears.
- After each working day, add one to three lines to the daily log.

Count progress from a terminal:

```bash
for f in docs/tasks/*.md; do
  printf "%-28s done %s, in progress %s, not started %s\n" "$f" \
    "$(grep -c '^- \[x\]' "$f")" "$(grep -c '^- \[~\]' "$f")" "$(grep -c '^- \[ \]' "$f")"
done
```

## Milestones

Status values: not started, in progress, done. A milestone is done only when its integration checkpoint passes.

| Milestone | What exists at the end | SC | BE | FE | Checkpoint | Status |
|---|---|---|---|---|---|---|
| M0. Foundation and spikes | Repo, frozen interfaces, local mainnet fork, risky assumptions tested | SC-01 to SC-06 | BE-01 to BE-06 | FE-01 to FE-04 | I-0 | in progress |
| M1. Core long | Long on aQQQ works end to end on mainnet staging | SC-10 to SC-15 | BE-10 to BE-16 | FE-10 to FE-13 | I-1 | not started |
| M2. Short and Earn | Short, lending, all five markets | SC-20 to SC-24 | BE-20 to BE-23 | FE-20 to FE-22 | I-2 | not started |
| M3. Market-hours protection | Soft limits by session, alerts, auto-deleverage, liquidator bot | SC-30 to SC-32 | BE-30 to BE-34 | FE-30 to FE-33 | I-3 | not started |
| M4. Cross-chain deposits | Deposit from and withdraw to other chains | SC-40 | BE-40 to BE-42 | FE-40 to FE-41 | I-4 | not started |
| M5. Hardening | Invariant tests, audit, monitoring, compliance gates | SC-50 to SC-56 | BE-50 to BE-55 | FE-50 to FE-55 | I-5 | not started |
| M6. Launch | Production deployment owned by the multisig, open to the public | SC-60 to SC-61 | BE-60 to BE-61 | FE-60 to FE-61 | I-6 | not started |

Milestones are ordered, but work inside a milestone runs in parallel. Work from a later milestone may start early when it does not depend on anything unfinished. For example BE-03 (one week of oracle logging), X-12 (talking to Anchored) and FE-04 (screen design) should start on day one.

## Task counts

Refresh with the command above.

| Area | Owner | Total | Done | In progress |
|---|---|---|---|---|
| Smart contracts | Wangsit | 30 | 4 | 17 |
| Backend | Dharu | 34 | 6 | 6 |
| Frontend | Nabil | 25 | 0 | 2 |
| Shared tasks | All three | 15 | 1 | 4 |
| Integration checkpoints | All three | 7 | 0 | 0 |

## What each person can start today without waiting

| Person | Start with | Why these |
|---|---|---|
| Wangsit | X-01, SC-01, SC-03, then SC-02 and SC-04 | The repo and the interfaces unblock everyone else |
| Dharu | BE-01, BE-02, BE-03, then BE-04 and BE-05 | The API shapes unblock Nabil. The oracle logger needs a full week, so it starts first |
| Nabil | FE-01, FE-02, FE-03, FE-04 | None of these wait for anyone. FE-03 reads real data straight from the chain |

## Blockers

Add a row the day a blocker appears. Remove it when solved and note the fix in the daily log.

| Date | Who is blocked | Waiting for whom | What is needed | Task |
|---|---|---|---|---|
| 13 October 2026 | Nabil | Nabil | Accept the repo invitation on GitHub | X-01 |
| 13 October 2026 | Wangsit, Dharu | Wangsit | Development wallets with USDC and MON on Monad mainnet, and the team multisig. Needed for the first real transactions | X-03, SC-04, BE-05, SC-15 |
| 13 October 2026 | Dharu | Dharu | KyberSwap client ID and Aurora Intents API key | BE-04, BE-05 |
| 13 October 2026 | Dharu | Wangsit | The mainnet deployment (`contracts/deployments/monad.json`). The stream timing check of BE-11 needs live oracle writes, which a fork does not get | BE-11, BE-15 |
| 13 October 2026 | Dharu | Dharu | Envio HyperSync API token from app.envio.dev, so the indexer reads from HyperSync instead of the RPC endpoint | BE-06, BE-13 |
| 13 October 2026 | Dharu, Nabil | Dharu, Nabil | Paid Monad RPC provider and hosting for the backend, database and web app. Needed at staging, not before | BE-15, FE-01 |

## Open questions that block work soon

The full list, with options for each, is in 09 under "Decisions waiting for the team".

| Question | Owner | Why it is urgent |
|---|---|---|
| Q-25 Domain | Nabil | `levra.com`, `.io`, `.xyz` and `.app` are in use |

## Integration checkpoint results

| Checkpoint | Date | Run by | Result | Notes and transaction hashes |
|---|---|---|---|---|
| I-0 | | | | |
| I-1 | | | | |
| I-2 | | | | |
| I-3 | | | | |
| I-4 | | | | |
| I-5 | | | | |
| I-6 | | | | |

## Real transactions on Monad mainnet

Every important real transaction goes here. This is also the evidence for the hackathon submission.

| Date | What | Transaction hash | By | Task |
|---|---|---|---|---|
| | | | | |

## Deployed addresses

The binding source is `contracts/deployments/*.json`. This table is a convenience copy for humans.

| Environment | Contract | Address | Date |
|---|---|---|---|
| | | | |

## Interface changes

One line for every change to 03 after the freeze.

| Date | What changed | Who is affected | PR |
|---|---|---|---|
| 13 October 2026 | Added the source quote time: `feedUpdatedAt` in `ISessionOracle.snapshot()` and `ILens.MarketView`, `oracleFeedUpdatedAt` in `Market`, `feedUpdatedAt` in the `price` stream event (D-23) | All three | sprint/long-flow |
| 13 October 2026 | Added `marketIds()` and `positionLtv()` to `IRiskManager` | Wangsit, Dharu | sprint/long-flow |
| 13 October 2026 | Added `GET /v1/config` and the deployment file schema in `packages/shared/deployments.ts` | Dharu, Nabil | sprint/long-flow |
| 13 October 2026 | Added `ILiquidator` and `liquidatorAbi` for the liquidator bot. The deployment file now carries `liquidator` and, after the vault script runs, `usdcVault` | Dharu | sprint/long-flow |
| 13 October 2026 | Added the oracle age poster to `IRiskManager`: `oracleAgePoster()`, `oracleAgeBounds()`, `setOracleAgeBounds()`, `setMaxOracleAge()`, two events and the error `OracleAgeOutOfBounds` (D-31). `ISessionOracle` now exposes `MAX_FEED_AGE()` and `MAX_PUBLISH_AGE()` | Dharu | sc/SC-11-oracle-age-and-repay |
| 13 October 2026 | Added `repayDebt()` and the event `DebtRepaid` to `IMarginRouter` (D-32). The API has no quote or history type for it yet | Dharu, Nabil | sc/SC-11-oracle-age-and-repay |
| 13 October 2026 | Added `repayDebt` to the history types and `repay` to the collateral quote actions, so the app can add margin with USDC (D-32) | Dharu, Nabil | be/BE-13-indexer |
| 13 October 2026 | Account and history notes in 03: positions live from `Lens`, when entry price and PnL are `"0"`, the history query parameters. No shape change | Dharu, Nabil | be/BE-13-indexer |
| 13 October 2026 | `IAnchoredStockOracle` gained the other read functions of the live oracle (`latestPriceNoOlderThan`, `latestPrices`, `latestPricesNoOlderThan`, `isSupportedPriceId`, `hasPrice`, `description`). The ABI is regenerated | Dharu | sc/Q-28-oracle-ages |
| 13 October 2026 | `morphoAbi` now also carries Morpho's 17 events (`SupplyCollateral`, `Borrow`, `Repay`, `Liquidate` and the rest), taken from Morpho's own `EventsLib` at the deployed version. Nothing was removed | Dharu | sc/morpho-events-abi |
| 13 October 2026 | Quote rules in 03: `gasLimit` `"0"` when not simulated, uint256 in `typedData` as decimal strings, where realized PnL comes from, warning thresholds. No shape change | Dharu, Nabil | be/BE-12-quote-long |
| 13 October 2026 | Wrote down what `Market.oracleStale` means (hard check, or older than `maxOracleAge` outside `CLOSED`) and when the DEX price fields are null. No shape change | Dharu, Nabil | be/BE-10-chain-reader |
| 13 October 2026 | Added the `PriceUpdated` event to `IAnchoredStockOracle` and its ABI, for the oracle logger. Written by Dharu, needs Wangsit's review | Wangsit, Dharu | sc/BE-03-oracle-price-event |

## Daily log

Newest first. One to three lines per person per working day: what got done, what is next, any blocker.

### 13 October 2026

- Dharu: BE-14 done and BE-13 started: `apps/indexer` follows router events into Postgres (Envio HyperSync, RPC as fallback, D-34), and `/v1/accounts` and `/history` serve positions from `Lens` with entry price and PnL from the indexed events. Checked end to end on the fork. Waiting: a HyperSync token (Dharu) and Morpho's events in the ABI export (Wangsit). After Wangsit's PR 13 and 14: `DebtRepaid` is indexed, `repay` is a collateral quote action and `repayDebt` a history type; our decisions are renumbered to D-33 (db package) and D-34 (indexer) because D-31 and D-32 were taken.

- Dharu: BE-16 formulas in `packages/shared/math.ts` (PR 10) match `Lens` exactly for a real long and short on the fork. BE-10 and BE-11 (chain reader, `/v1/config`, `/v1/session`, `/v1/markets`, `/v1/stream`) are written and checked against direct contract reads on the fork. Next: BE-12 quote for long.
- Dharu: BE-12 done on the fork: open long with first-use signatures in one `multicall`, reduce, remove collateral and full close, all from quotes over the live KyberSwap route. The router held no USDC afterwards. Request for Wangsit: add `IERC20Permit` (`nonces`, `name`, `version`) to the ABI export; the API uses a minimal fragment until then. Next: BE-06 and BE-13 indexer, then BE-14 accounts.

- Dharu: BE-01 done (PR 7): api with `/v1/health`, keeper job runner with heartbeats, `packages/db`, local Postgres, backend CI passing on GitHub.
- Dharu: BE-03 done: the oracle logger backfilled two weeks of `PriceUpdated` logs and keeps following them. Report in `docs/reports/oracle-2026-10-13.md`. For Wangsit (Q-28): BIL's source quote reached 81.5 minutes after hours, above the 1 hour hard age in `SessionOracle`; nothing is written while `CLOSED`, so `publishedAt` stops too; the session flips for about 15 minutes every Friday at 20:00 ET. Needs PR 8 (event ABI) reviewed by Wangsit.

- Dharu: backend plan adjusted so values that wait on oracle data are picked up without code changes: BE-03 becomes a persistent logger in Postgres with generated reports, BE-10 reads `maxOracleAge` and `stale` from the chain, BE-16 checks bid and ask on every read with the same condition as `SessionOracle`.
- Dharu: keeper plan adjusted the same way: new BE-17 posts `maxOracleAge` from data within multisig bounds, on the source quote clock of D-23 (needs Q-27 from Wangsit); BE-30 and BE-50 take the schedule and limits from BE-03 data; BE-31 and BE-33 use the BE-30 calendar; BE-55 covers the new key.
- Wangsit: SC-03 written and in review: Solidity interfaces, events, errors, ABI export to `packages/shared/abis/`. SC-01 partly done along the way.
- All: interface decisions made together: backend builds transactions (D-19), one confirmation on first use (D-20), backend stack (D-21), Privy for sign-in (D-22). Doc 03 updated to match. The full freeze (X-04) still needs SC-03 and BE-02.
- Wangsit: X-01 started. Private repo created at `github.com/wngstnr-code/levra` with the monorepo root. Collaborators, `CODEOWNERS` and branch protection are still open.
- All: decided together: name Levra (D-15), sign-in by email or passkey in scope (D-16), private repo under `wngstnr-code` (D-17), scope and split of work approved (D-18).
- All: development docs written. Nothing is built yet. Next: X-01, SC-01, SC-03, BE-01, BE-02, BE-03, FE-01 to FE-04.
- Early findings from quick read-only checks (not a replacement for the spikes):
  - Q-17: Anvil 1.8.3 forks Monad mainnet through `rpc2.monad.xyz`. Chain ID 143, the Anchored oracle and Morpho are readable, and an impersonated `approve` on USDC succeeds. A full swap and Morpho flow on the fork is not tested yet (SC-02).
  - Q-19: for QQQ in the OVERNIGHT session, best bid and best ask were both filled and sensible (740.03 and 741.17 around a price of 740.60). One sample only (BE-03).
  - Q-18: USDC reports `version()` = "2" and has `nonces(address)`, so `permit` is likely supported. `DOMAIN_SEPARATOR()` timed out on the public RPC, so this is not confirmed (SC-05).
  - SC-06: Morpho holds about 10.5 million idle USDC, so flash loan room is far above what we need.
- All: interface agreement frozen. PR 1 (contract interfaces and ABIs) and PR 2 (API schemas) are merged. SC-03, BE-02 and X-04 are done.
- Findings from read-only checks and from Anchored's documentation, all written into 05:
  - Tokens: stock tokens are beacon proxies behind a compliance contract with a denylist. Morpho is not on it. They have no `permit`. USDC has `permit` (Q-18 answered).
  - Pools: all three pair directly with USDC, one hop (Q-16 answered). KyberSwap builds calldata for a contract sender and recipient.
  - Oracle: 10 minute heartbeat, about 15 minutes of quote delay, price carried forward while closed, freshness should use `feedUpdateTimestamp`. This opens Q-22.
  - Sessions: weekly close Friday 8:00 PM and weekly open Sunday 8:00 PM, US Eastern Time.
  - Addresses: both Morpho vault factories, the public allocator, Permit2, Multicall3 and Safe 1.4.1 exist on Monad.
  - Cross-chain: price-only quotes into Monad work from Base, Arbitrum and Ethereum, about 0.22% cost and under a minute.
  - Eligibility: Anchored's prohibited list is longer than "United States and China". This opens Q-24.
- New documents: `docs/10-screens.md` (screen draft for FE-04), `docs/outreach/anchored-questions.md` (X-12 draft, not sent), `docs/drafts/risk-disclosure.md` (X-11 draft, not reviewed).
- No product code was written in this round, by the team's choice. Spikes that need code or funds are still open.
- All: decisions D-23 to D-30 taken. Levra will be submitted to Monad Metropolis (D-30). Sprint order: real long on aQQQ, positions and close, cross-chain deposit, short, sign-in by email. Deadline 14 October 2026 at 10:59 WIB.
- Wangsit: contracts written on `sprint/long-flow`: `SessionOracle`, `RiskManager`, `MarginRouter` (long, short, close, auto-deleverage, one confirmation with signatures) and `Lens`. 48 tests pass on a fork of Monad with real Morpho, the real Anchored oracle and real tokens.
- Wangsit: `script/Deploy.s.sol` deploys everything and creates five markets. On a local fork, `script/e2e-long.sh` opened and closed a long on aQQQ through the live KyberSwap route and the router ended with no tokens. Nothing is deployed on mainnet yet. That needs a funded deployer wallet (X-03).
- Backend and frontend for the sprint are not started. They belong to Dharu and Nabil.
- Wangsit: PR 4 opened for the contracts. SC-06 done: the missing addresses are in `packages/shared/addresses.ts`. SC-14: `packages/shared` now validates and reads the deployment file and exposes the stock list in `markets.ts`.
- Wangsit: PR 5 opened with the CI workflow, 8 security tests (reentrancy and signature replay) and one test that walks a full weekend. 57 tests pass. SC-05 done. The aQQQ and aHOOD pools have no hook and charge a 0.90% fee per swap.
- Wangsit: CI is green on PR 5 (SC-01 done). On a local fork, short and auto-deleverage both ran through the live KyberSwap route (`e2e-short.sh`, `e2e-protection.sh`). Two things the backend must know: KyberSwap's calldata enforces its own minimum return from the `slippageTolerance` sent when building it, and KyberSwap refuses some sender addresses.
- Wangsit: SC-23 written. The USDC vault is created from Morpho's MetaMorpho v1.1 factory by `script/DeployVault.s.sol` and tested on a fork. 63 contract tests pass.
- Wangsit: SC-32 written. `Liquidator` liquidates long and short positions with no capital of its own and is deployed by the deployment script. 70 contract tests pass and CI is green.
- Wangsit: SC-50, SC-51 and SC-55 written. Invariant campaign on a fork, Slither clean after review, gas numbers recorded, and a handover of ownership to a timelock behind the multisig. Tests now fork a pinned block, which made them repeatable and fast. 75 tests plus the invariant campaign pass.
- Wangsit: Q-27 answered yes (D-31) and implemented: the oracle age poster moves `maxOracleAge` inside owner-set bounds, which unblocks BE-17. `repayDebt` added to the router (D-32). 84 contract tests pass. Dharu: the API needs a way to quote and record `repayDebt`. Nabil: this is the "add margin" action for a long.
- Wangsit: reviewed the shared formulas and the long quote math (BE-16, BE-12) against the contracts: they match. Dharu's fork tests pass against a fresh fork deployment, including "shared formulas match Lens". Two notes for Dharu: `liquidationPriceE8` for a long still mirrors the old `Lens` rounding (same result in practice, PR 13 changed the contract to divide by `collateral * lltv`), and `maxLtv` is set to the worst case with no headroom, so interest accrued between quote and execution on an existing position could trip `UserLimitExceeded` when the fill lands exactly on the minimum.
- Wangsit: Q-28 proposed and implemented as D-35 (per-market hard oracle ages), waiting for confirmation. Liquidation ran through the live route on a fork. Oracle fuzz tests, Slither in CI, the vault in the ownership handover. 91 contract tests pass.
- Wangsit: the first mainnet run is scripted and rehearsed on a fork with 8 USDC (`make deploy-monad`, `make first-long-monad CONFIRM=yes`). The invariant campaign now includes keeper reductions that succeed.
- Wangsit: `morphoAbi` in `packages/shared/abis/` now includes Morpho's events, which unblocks the indexer and the liquidator bot for users who use Morpho directly. A test decodes a real `Repay` log from Monad with it.
