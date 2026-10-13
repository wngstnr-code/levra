# Incident runbook

What to do when something goes wrong in production or staging. Written for task BE-53. It covers the six situations listed in `07-testing-and-security.md`, plus database backup and restore.

Status of this document: written, not yet read by all three of us and not yet practiced (BE-53 "Done when"). Some steps depend on things that do not exist yet. Each of those is marked **Not available yet** with the task that adds it.

## Before anything else

1. Write down the time (UTC and WIB) and what you saw. Keep a short log in the team channel while you work.
2. Check `GET /v1/status`. It shows the oracle age and stale flag per stock, the health of every keeper, and the indexer lag.
3. Decide if user funds can be lost right now. If yes, pause new positions first (below), then investigate.
4. Never pause or block closing. There is no switch for it, and that is on purpose (CLAUDE.md section 8).

## Tools

Addresses: `contracts/deployments/monad.json`, also in `docs/public/contracts.md`. Today, on staging:

| Contract | Address |
|---|---|
| Morpho | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` |
| `RiskManager` | `0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F` |
| `MarginRouter` | `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6` |
| USDC vault (`lvUSDC`) | `0xfB99A7E3f5571baA363d67F7823bb354cfd95447` |

Who can act, today: the owner is one team key (`0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`). No guardian is set. After the handover (SC-55) the owner is a 2-day timelock behind the team multisig, and the multisig is the guardian. Then the fast actions below are sent by the guardian through the Safe, not by the owner.

Fast actions, all immediate:

```bash
# Pause new positions. The guardian can pause, only the owner can resume.
cast send $RISK_MANAGER "setOpeningPaused(bool)" true --rpc-url $RPC --account <owner-or-guardian>

# Check it
cast call $RISK_MANAGER "openingPaused()(bool)" --rpc-url $RPC

# Tighten one market: lower soft limits and position cap. Values can only go down.
cast send $RISK_MANAGER "tightenMarket(bytes32,uint64,uint64,uint128)" <marketId> <softLtvOpen> <softLtvClosed> <maxPositionUsd> \
  --rpc-url $RPC --account <owner-or-guardian>
```

Units for `tightenMarket` follow `docs/03-interfaces.md` section 1. Read the current values first with `config(bytes32)` and send values that are equal or lower.

## 1. The oracle price stops updating

How you notice: the team monitor (BE-50) posts "oracle price is ... old" in the team channel, or `/v1/status` shows a stock as stale or its age above `ageLimitSeconds`. The team channel itself needs `TEAM_TELEGRAM_CHAT_ID` or `TEAM_WEBHOOK_URL` on the keeper.

First check if it is normal:

- While the session is `CLOSED` (weekend, holiday, overnight gap), no updates is normal. The price is carried forward.
- Every Friday at about 20:00 to 20:15 ET the session flips between `POST_MARKET` and `CLOSED`. That is normal (BE-03 report, T-20).

If it is not normal:

1. Confirm on chain: read the Anchored oracle directly (`latestPrice` for the stock) and compare the source quote time with the current time. Check the session.
2. When the oracle is older than `maxOracleAge`, `RiskManager.checkOpen` already rejects new positions in that market. Nothing to do on our side for opening.
3. If more than one market is affected, or the price looks wrong (not only old), pause new positions.
4. Contact Anchored (X-12 contact). Write down what they say.
5. Watch the hard age. When the source quote is older than the hard age of `SessionOracle`, `price()` reverts and Morpho liquidations in that market stop (T-20). A user can still close in full directly on Morpho (`repay` all, then `withdrawCollateral`), because Morpho skips the price check when no debt is left. Whether a close through the router works in this state is not verified. If the outage looks long, tell users before the hard age is reached.
6. When updates resume, check `/v1/status` shows fresh prices, then resume opening (owner only).

## 2. Anchored pauses a token or blocks an address

How you notice: transfers of a stock token revert, swaps for that stock fail in quotes, or Anchored announces it.

1. Find out exactly what is blocked. Try a read-only `eth_call` of a transfer from Morpho, from the router, and from a normal user address. The compliance contract has a denylist (T-08).
2. Pause new positions.
3. Tighten the affected markets to a position cap of zero, so nothing new can be opened there even after resuming.
4. If Morpho is blocked: collateral in that market is locked. Our code cannot fix this. Tell users immediately, honestly, and point to Anchored.
5. If only the router is blocked: users can still close directly on Morpho. Send them the steps in `docs/public/contracts.md` ("Leaving without the Levra app").
6. For the USDC vault: lower the supply cap of the affected market to zero. Lowering is immediate (`docs/public/contracts.md`).
7. Record the incident and the answer from Anchored in `docs/09-decisions-and-questions.md`.

## 3. A bug is found in the router

1. Pause new positions at once. Do not wait to understand the bug fully.
2. Ask users to revoke the router's Morpho authorization. Post the `setAuthorization(router, false)` command from `docs/public/contracts.md` on every channel we have, and show it in the app.
3. Remind users that their positions stay in Morpho and can be closed there directly, without the router.
4. Stop the protector keeper and the liquidator keeper if the bug touches `deleverage` or `Liquidator`. Liquidations by other Morpho liquidators still work.
5. The contracts are not upgradeable. A fix means a new deployment and a new address. Users must authorize the new router themselves.
6. Write the details in a private channel first. Publish after users had time to revoke. Follow the bug bounty draft (`docs/drafts/bug-bounty.md`) for the reporter.

## 4. There is bad debt in a market

How you notice: a liquidation leaves debt with no collateral behind it. Morpho then lowers the value of every supply share in that market, so lenders take the loss. The team monitor (BE-50) posts every liquidation with bad debt in the team channel.

1. Confirm on chain: read the market on Morpho (`market(id)`) before and after the liquidation block. Bad debt shows as a drop in total supply assets in the same transaction as the `Liquidate` event.
2. Pause new positions.
3. Tighten the market: lower the soft limits and the position cap.
4. For the USDC vault: lower the supply cap of that market. Lowering is immediate. New deposits stop going there.
5. Find the cause: price gap at the open (04, gap scenarios), oracle stale, the liquidator bot down, or depth too thin for the position size (T-14).
6. Tell lenders how much was lost and why. Do not promise a refund unless the team decided it.
7. Update `docs/04-risk-rules.md` if a limit was wrong. Mark the new number as an initial proposal.

## 5. The keeper is down

How you notice: the team monitor (BE-50) posts a late heartbeat, an error or a low MON balance in the team channel, or `/v1/status` shows a keeper as not healthy. The monitor cannot report its own death, so an outside uptime check on `/v1/status` is part of hosting (BE-15).

What breaks when each job stops:

| Job | What stops | Urgency |
|---|---|---|
| `liquidator` | Our own liquidations. Other Morpho liquidators may still act, but our markets are small, so do not count on it | High |
| `protector` (BE-31) | Auto-deleverage before the close. Users with protection on are not reduced | High before a close |
| `calendar` (BE-30) | `nextCloseAt` is not updated. Stricter soft limits may start late | High on Fridays and before holidays |
| `oracleAgePoster` | `maxOracleAge` stays at its last value. Safe | Low |
| `oracleMonitor`, `marketDepth` | Data for reports and DEX prices. Quotes still work, DEX price fields become null | Low |
| `alerts` (BE-33) | Alerts to users before the close and on events. Users are not warned | High before a close |
| `transfers` (BE-40) | Cross-chain transfer status is only refreshed while a user has the app open; no "deposit arrived" alert | Medium |
| `monitor` (BE-50) | Team alerts. Nothing else stops, but problems go unseen | High |

Steps:

1. Read the keeper log. Look for an RPC error, a KyberSwap error, or a key with no MON.
2. Check the MON balance of each keeper key. Top up within the limit in BE-55.
3. Restart the keeper. Jobs resume from their cursors in the database.
4. If it is a Friday or the day before a holiday and the keeper cannot be fixed before the close, tell users with protection on that it may not run, so they can reduce their positions themselves.
5. If the key may have leaked, follow the key rotation steps (BE-55). The multisig removes the role from the old address.

## 6. The backend or the site is down

User funds are not at risk. Positions sit in Morpho and can be closed without us.

1. Check which part is down: `GET /v1/health` (API), `/v1/status` (indexer lag, keepers), the web app address.
2. RPC provider: if every chain read fails, the API answers `UPSTREAM_ERROR`. Switch to the backup RPC endpoint in the env and restart.
3. Database: if Postgres is lost, restore from the last backup (below). The indexer then catches up from its cursor. Positions are read live from `Lens`, so they are right as soon as the API is back. History catches up with the indexer.
4. Post a short note on the status page and social channels, with a link to "Leaving without the Levra app" if the outage looks long.
5. After recovery, check `/v1/status`: indexer lag back to a few blocks, all keepers healthy.

## Database backup and restore

The database is a copy of the chain plus our own records (history, oracle log, depth, alert settings). The chain is the source of truth, so losing the database loses no funds. It does lose the oracle log and history until the indexer replays, and the alert settings and terms acceptances for good.

Scripts live in `packages/db/scripts/`. They need `pg_dump`, `pg_restore` and `psql` version 17 or newer on PATH (or in the folder `PG_BIN`). With `PG_DOCKER_SERVICE=postgres` they run inside the docker compose Postgres container instead, and the file stays on the host. The password is passed through `PGPASSWORD` and never shows on the command line.

```bash
# Backup. Keeps the newest BACKUP_KEEP files (default 14) in BACKUP_DIR (default packages/db/backups, ignored by git).
DATABASE_URL=postgres://levra:levra@localhost:5442/levra_staging \
  pnpm --filter @levra/db exec tsx scripts/backup.ts

# Restore into an empty database. Refuses a database that already has tables.
DATABASE_URL=postgres://levra:levra@localhost:5442/levra_new \
  pnpm --filter @levra/db exec tsx scripts/restore.ts <file.dump>

# Restore over an existing database. Drops and replaces its tables in one transaction.
pnpm --filter @levra/db exec tsx scripts/restore.ts <file.dump> --replace

# Restore test: backs up, restores into a new scratch database, compares the row count of
# every table, then drops the scratch database. Exits with code 1 on a mismatch.
DATABASE_URL=postgres://levra:levra@localhost:5442/levra_staging \
  pnpm --filter @levra/db exec tsx scripts/restore-check.ts
```

The restore test counts each table before and after the dump, because the indexer and keepers keep writing while it runs. A restored count is correct when it lies between those two numbers.

After a restore: stop the API, indexer and keepers before restoring with `--replace`, start them after. Then check `/v1/status`.

Results so far:

| Date | Where | Result |
|---|---|---|
| 13 October 2026 | Dharu's machine, docker Postgres, `levra_staging` (7 tables, 11 router events, 32 Morpho events) | Passed, 2.1 s with host tools, 5.4 s inside the container |
| 13 October 2026 | Dharu's machine, docker Postgres, `levra` (4,621 oracle updates) | Passed, 1.1 s |

**Not available yet:** scheduled backups and off-site copies on the hosted database (needs hosting, BE-15). When hosting is chosen, run `backup.ts` on a daily schedule, copy each file to storage outside that host, and run `restore-check.ts` once a month.
