# Levra development docs

This folder is the working guide for building the final version of Levra. It is not a trial version. The source of the idea is `Ide Gabungan - Akun Margin Saham Ter-tokenisasi.pdf`. The docs here turn that idea into a design, interface agreements, and task lists.

The product in one sentence: one account to buy tokenized stocks with borrowed money (long), profit when the price falls (short), or lend assets to earn interest, with funds that can be sent from any network. It runs on three chains:

| Chain | Stocks | Status |
|---|---|---|
| Monad | Anchored stocks | Live on mainnet since 13 October 2026 |
| Base | Coinbase stocks (B20) | Built and rehearsed, not deployed yet. Current focus (D-78) |
| X Layer | Wrapped xStocks | Researched; built after Base |

## Team

Ownership as in [06-team-workflow.md](06-team-workflow.md) and `.github/CODEOWNERS`.

| Person | Part | Owns | Task list |
|---|---|---|---|
| Wangsit | Smart contracts (SC) | `contracts/`; in `packages/shared`: `abis/`, `addresses.ts`, `markets.ts`, `chains.ts`, `deployments*.ts` | [tasks/sc-wangsit.md](tasks/sc-wangsit.md) |
| Dharu | Backend (BE) | `apps/api/`, `apps/indexer/`, `apps/keeper/`, `packages/db/`, `packages/kyber/`, `packages/intents/`; in `packages/shared`: `api/`, `math.ts`, `gaps.ts` | [tasks/be-dharu.md](tasks/be-dharu.md) |
| Nabil | Frontend (FE) | `apps/web/` | [tasks/fe-nabil.md](tasks/fe-nabil.md) |
| All three | Shared things | `docs/`, repo setup, non-engineering work | [tasks/00-shared.md](tasks/00-shared.md) |

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
| [11-base-stocksmaxxing.md](11-base-stocksmaxxing.md) | Levra on Base and the Stocks Maxxing submission: idea, stack per chain, Coinbase stock facts, task split | Everyone |
| [12-xlayer-tapeout.md](12-xlayer-tapeout.md) | Levra on X Layer and the TapeOut Accelerate submission: final 3-chain idea, X Layer facts, TapeOut use, task split | Everyone |
| [public/contracts.md](public/contracts.md) | Public contract documentation: addresses, roles, what the team can and cannot do, how to leave without the app | Everyone |
| [outreach/anchored-questions.md](outreach/anchored-questions.md) | Draft message to the token issuer | SC |
| [drafts/risk-disclosure.md](drafts/risk-disclosure.md) | Draft risk disclosure, not reviewed by counsel | Everyone |
| [drafts/bug-bounty.md](drafts/bug-bounty.md) | Draft bug bounty program. Rewards and channel not decided (Q-29) | SC |
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
| **Verified** | Read directly from the network or from official documentation. Each fact states the date it was read |
| **Not verified** | A reasonable assumption that is not yet proven. There is a task to prove it |
| **Initial proposal** | A starting number that must be tested before it is used with real money |
| `SC-12`, `BE-12`, `FE-11`, `X-03` | Task numbers. SC, BE, FE match the part; X is for shared tasks |
| `D-03`, `Q-04` | Decision (D) and open question (Q) numbers in 09-decisions-and-questions.md |
| M0 to M6 | Build milestones, explained in PROGRESS.md |

## Where to find what is open

- Open questions and the decisions still waiting for the team: [09-decisions-and-questions.md](09-decisions-and-questions.md).
- Blockers, known issues and the latest daily log: [PROGRESS.md](PROGRESS.md).
- The product name is Levra (D-15). Packages use the `@levra/*` scope and contract names stay descriptive, such as `MarginRouter`.
