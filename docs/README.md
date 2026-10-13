# Levra development docs

This folder is the working guide for building the final version of Levra, a margin account for tokenized stocks on Monad. It is not a trial version. The source of the idea is `Ide Gabungan - Akun Margin Saham Ter-tokenisasi.pdf`. The docs here turn that idea into a design, interface agreements, and task lists.

The product in one sentence: one account on Monad to buy tokenized stocks with borrowed money (long), profit when the price falls (short), or lend assets to earn interest, with funds that can be sent from any network.

## Team

| Person | Part | Folders owned | Task list |
|---|---|---|---|
| Wangsit | Smart contracts (SC) | `contracts/` | [tasks/sc-wangsit.md](tasks/sc-wangsit.md) |
| Dharu | Backend (BE) | `apps/api/`, `apps/indexer/`, `apps/keeper/` | [tasks/be-dharu.md](tasks/be-dharu.md) |
| Nabil | Frontend (FE) | `apps/web/` | [tasks/fe-nabil.md](tasks/fe-nabil.md) |
| All three | Shared things | `packages/shared/`, `docs/` | [tasks/00-shared.md](tasks/00-shared.md) |

## Reading order

Everyone reads these four docs first, in this order:

1. [01-product.md](01-product.md): what is built, for whom, and the seven user flows.
2. [02-architecture.md](02-architecture.md): the parts and how they connect.
3. [03-interfaces.md](03-interfaces.md): the agreements between SC, BE, and FE. This is the most important doc for parallel work.
4. [06-team-workflow.md](06-team-workflow.md): rules for the repo, branches, reviews, and how to report progress.

After that, read your own task list, then other docs when needed:

| Doc | Contents | Most important for |
|---|---|---|
| [04-risk-rules.md](04-risk-rules.md) | Borrow limits, formulas, market-hours rules, requirements for adding a stock | SC, BE |
| [05-addresses-and-services.md](05-addresses-and-services.md) | Addresses on Monad, external services, measured numbers | Everyone |
| [07-testing-and-security.md](07-testing-and-security.md) | How to test, threat list, audit | SC, BE |
| [08-startup-readiness.md](08-startup-readiness.md) | Launch requirements, operations, legal, business, competition submission | Everyone |
| [09-decisions-and-questions.md](09-decisions-and-questions.md) | Decisions already made and questions still open | Everyone |
| [10-screens.md](10-screens.md) | Draft of every screen: data, actions, states, and data still missing from the API | FE, BE |
| [outreach/anchored-questions.md](outreach/anchored-questions.md) | Draft message to the token issuer | SC |
| [drafts/risk-disclosure.md](drafts/risk-disclosure.md) | Draft risk disclosure, not reviewed by counsel | Everyone |
| [PROGRESS.md](PROGRESS.md) | Progress board: milestones, blockers, daily log | Everyone |

Claude sessions in this repo follow [`../CLAUDE.md`](../CLAUDE.md). It tells every new session to read these docs first.

## Five rules for working in parallel

1. **One folder, one owner.** Only the owner changes their folder. Changes to `packages/shared/` and `docs/03-interfaces.md` must be approved by everyone affected.
2. **Agree first, fill in later.** The shape of contract functions, events, and API endpoints is agreed and frozen at milestone M0. After that, each person can build without waiting for the others.
3. **No mock data inside the product.** Made-up sample data may only exist in test files. To develop before another part is finished, use real data from Monad and a local mainnet fork (see 02-architecture.md).
4. **One source for each thing.** Addresses live in `packages/shared`, ABIs are generated from `contracts/`, and API data shapes live in `packages/shared/api`. Do not copy them elsewhere.
5. **Progress is recorded where the task is.** Check off tasks in your own task file in the same PR as the work. Blockers are written in PROGRESS.md on the same day.

## Markers used in these docs

| Marker | Meaning |
|---|---|
| **Verified** | Read directly from the network or from official documentation on 13 October 2026 |
| **Not verified** | A reasonable assumption that is not yet proven. There is a task to prove it |
| **Initial proposal** | A starting number that must be tested before it is used with real money |
| `SC-12`, `BE-12`, `FE-11`, `X-03` | Task numbers. SC, BE, FE match the part; X is for shared tasks |
| `D-03`, `Q-04` | Decision (D) and open question (Q) numbers in 09-decisions-and-questions.md |
| M0 to M6 | Build milestones, explained in PROGRESS.md |

## Things not yet decided that need attention soon

- The decisions listed with options in 09 under "Decisions waiting for the team". The product name is decided: Levra (D-15). Packages use the `@levra/*` scope and contract names stay descriptive, such as `MarginRouter`.
- The three riskiest things to prove in M0: a real swap transaction from a contract (SC-04), how the Anchored oracle behaves when the market is closed (BE-03), and a real cross-chain deposit (BE-05).
