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
| Smart contracts | Wangsit | 30 | 1 | 4 |
| Backend | Dharu | 33 | 1 | 4 |
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
| | | | |

## Daily log

Newest first. One to three lines per person per working day: what got done, what is next, any blocker.

### 13 October 2026

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
