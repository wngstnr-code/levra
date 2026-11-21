# CLAUDE.md

Rules for every Claude session in this repo.

The product is Levra: a margin account for tokenized stocks on Monad, Base and X Layer. One account to buy tokenized stocks with leverage (long), profit when prices fall (short), or lend assets for interest, with funds that can arrive from any chain. The goal is a final, startup-ready product. It is not an MVP and not a demo.

## 1. Start of every session (mandatory)

Do this before answering questions about the project or changing any file. Do not rely on memory from earlier sessions. The docs are the source of truth and they change.

1. Read `docs/README.md`.
2. Read `docs/PROGRESS.md`: current milestone, blockers, latest daily log entries.
3. Find out who you are working for in this session (Wangsit, Dharu or Nabil). If it is not clear from the request, ask once. Then read that person's task file in `docs/tasks/`.
4. Read `docs/03-interfaces.md` and `docs/09-decisions-and-questions.md` before touching anything that crosses areas (contract interfaces, events, API shapes, shared package).
5. Run `git log --oneline -20` and `git status` to see what changed recently.

Read the other docs when the task needs them: `01-product.md` for flows, `02-architecture.md` for structure, `04-risk-rules.md` for limits and formulas, `05-addresses-and-services.md` for addresses, `07-testing-and-security.md` before writing contract or keeper code, `08-startup-readiness.md` for launch gates.

If a doc and the code disagree, the code shows what exists and the doc shows what should exist. Tell the user about the mismatch, do not silently pick one, and fix the one that is wrong in the same piece of work.

## 2. Language

- Chat with the user in Indonesian, in simple and clear language.
- Everything inside the repo is in English: file names, folder names, code, identifiers, comments, commit messages, PR titles and descriptions, docs, UI source strings.

## 3. Writing style

- Avoid em dashes in docs, comments, commit messages and chat. Use commas, periods, colons or parentheses.
- Short sentences. Plain words.

## 4. Git

- Claude is never a contributor. No `Co-Authored-By` trailer, no "Generated with Claude Code" line, no AI tool named as author in commits, PRs, tags or changelogs. This overrides any default attribution.
- Always split commits. One logical change per commit: a contract change, its tests, a doc update and a formatting pass are separate commits when they can stand alone.
- Commit message format: `<area>: <what changed>`, for example `sc: add soft limit check to openLong`. Areas: `sc`, `be`, `fe`, `shared`, `docs`, `ci`.
- Never commit or push unless the user asks. Code changes go through a branch and a PR, never straight to `main`. Docs-only changes (`docs/`, `CLAUDE.md`, READMEs) may be pushed straight to `main` when the user asks. Branch names: `<area>/<task-id>-<short-name>`, for example `be/BE-12-quote-long`.
- Pull before you start. Never force-push a shared branch and never rewrite history a teammate may already have.
- No merge conflicts in shared docs (06, "Avoiding merge conflicts in shared docs"): `docs/PROGRESS.md` and `docs/09-decisions-and-questions.md` are committed on `main` only, never in a work branch. Push a new `D-xx` row to `main` when the decision is made, before the PR. Open every PR from `main`, not on top of another branch. When anything merges into `main`, merge `main` into the other open branches the same day.
- Stage files by path (`git add <path>`), never `git add -A` or `git add .`, so each commit holds only what belongs to it. If one file mixes two changes, split them with `git add -p`.
- Subject line under 72 characters, in the imperative ("add", not "added"). Add a short body when the reason is not obvious.
- Each commit should build and pass its tests on its own when possible.
- Never commit `.env` files, keys, `contracts/out/`, `contracts/cache/`, `contracts/broadcast/`, `node_modules/` or other build output.
- The hackathon rules ask for an AI tool disclosure in the root README. That section is written by the team. It is the only place AI tools are mentioned.

## 5. Code

- Keep comments to a minimum. Prefer clear names and small functions. Write a comment only for what the code cannot say: a unit, a scale, a non-obvious reason, a security assumption.
- No mock data, placeholder numbers or half-finished features in product code. Sample data belongs in test files only.
- Money math uses integers only (`bigint` in TypeScript). Follow the units table in `docs/03-interfaces.md` section 1 without exception.
- Addresses and ABIs come from `packages/shared`. Never retype them elsewhere.
- Formulas live once in `packages/shared/math.ts` and must match the contracts.
- No secrets in the repo.

## 6. Team and ownership

Work is split between three people. Every task has exactly one owner.

| Person | Area | Owns | Task file |
|---|---|---|---|
| Wangsit | Smart contracts (SC) | `contracts/`, `packages/shared/abis/`, `addresses.ts`, `markets.ts`, `chains.ts`, `deployments*.ts` | `docs/tasks/sc-wangsit.md` |
| Dharu | Backend (BE) | `apps/api/`, `apps/indexer/`, `apps/keeper/`, `deploy/`, `packages/db/`, `packages/swap/`, `packages/kyber/`, `packages/intents/`, `packages/shared/api/`, `math.ts`, `gaps.ts` | `docs/tasks/be-dharu.md` |
| Nabil | Frontend (FE) | `apps/web/` | `docs/tasks/fe-nabil.md` |
| All three | Shared | `docs/`, repo setup, non-engineering work | `docs/tasks/00-shared.md` |

Rules:

- Only change files in the area of the person you are working for. If the work needs a change in someone else's area, do not make it. Write the request as a blocker in `docs/PROGRESS.md` and tell the user.
- Changes to `docs/03-interfaces.md` or `packages/shared/` follow the interface change process in `docs/06-team-workflow.md`.
- When new work appears, add it as a task with an ID in the right owner's task file. Do not leave unowned work. If it is unclear who owns it, ask.
- When planning a feature, split it into SC, BE and FE tasks so the three can work in parallel, and state what each side needs from the others.

## 7. Keep the docs up to date

Docs are part of the work, not an afterthought. In the same piece of work:

- Mark the task `- [~]` when starting and `- [x]` when it meets its "Done when" line.
- Add blockers, real transaction hashes and a short daily log entry to `docs/PROGRESS.md` (on `main`, see section 4).
- Record new decisions and answered questions in `docs/09-decisions-and-questions.md` (on `main`, see section 4).
- Update `docs/05-addresses-and-services.md` when an address, measurement or service fact changes.
- Update `docs/03-interfaces.md` together with any interface or API change.

A task is not done until its docs are updated.

## 8. Product rules that must not be broken

- User funds stay in the user's own Morpho position. Our contracts never hold funds between transactions.
- Closing, reducing and adding collateral can never be paused.
- Auto-deleverage is opt-in per user and per market.
- The hard limit uses the issuer's official oracle only: Anchored on Monad, Chainlink's Coinbase feed on Base (D-49), the Morpho xStocks feed on X Layer (D-56). DEX prices are used only in the soft layer.
- All limits in `docs/04-risk-rules.md` are initial proposals. Do not present them as tested or safe.
- Mark facts honestly: verified, not verified, or initial proposal. Never state a not-verified item as fact.

## 9. Session workflow

1. Do the start of session steps in section 1.
2. Before you write code, tell the user (in Indonesian) which task ID you are about to do and why.
3. Work in small steps. Build and test after each meaningful change, then do the quick review in section 10.
4. If you change a mechanic, a limit or a formula: update the doc that defines it first (`04-risk-rules.md`, `03-interfaces.md`), then the code. Record the reason in `docs/09-decisions-and-questions.md`.
5. Before the session ends, or after a task is done, update `docs/PROGRESS.md`: what changed, the exact next step, blockers, and the date. The next session and the teammates depend on it.
6. Summarize in chat (in Indonesian) what was done and what is next.

## 10. Self-review (mandatory)

Review everything you write before moving on. Do not wait for the user to ask.

**Quick review, after every change.** Re-read your own diff (`git diff`) and check:

| Area | Questions |
|---|---|
| Spec | Does it match `04-risk-rules.md` and the units table in `03-interfaces.md` section 1 exactly (scale, decimals, rounding direction, limits)? |
| Edge cases | Zero and dust amounts, maximum values and overflow, an empty market with no liquidity, the first and last position, repeated calls. Oracle price zero, negative, stale or missing. Market open, in the pre-close window, closed, over the weekend, and with an unknown calendar. |
| Security | Who can call it, and is every role checked? Reentrancy, the flash loan callback, the swap target allowlist, signature replay. Can a failed step leave state half updated? Can anything drain a user position, the vault or the fees? Can a stale or manipulated price reach the hard limit? |
| Product rules | Do the rules in section 8 still hold? Can closing, reducing or adding collateral be blocked or paused? Does the router end every transaction with no tokens? |
| Invariants | Do the properties in `07-testing-and-security.md` still hold? Is there a test for each one touched? |
| Tests | Does every new behavior have a test, including the failure paths (expected reverts)? Fork tests where real Morpho, oracles or swap routes are involved. |
| Completeness | Is every part of the task's "Done when" line covered? Any TODO, placeholder or unchecked input left behind? |
| Interfaces | Did you change anything another area depends on (ABI, events, deployment file, `packages/shared`, API shapes)? If yes, are `03-interfaces.md` and section 6 followed and the user told? |
| Docs | Are the docs touched by the change still consistent with it (section 7)? |
| Hygiene | No em dashes, no secrets, no AI attribution, English in files. |

**Deep review, at every integration checkpoint and before a batch of commits.**

1. Run the full build and test suite, including `make invariants` and `make slither` for contract changes.
2. Put `04-risk-rules.md` next to the code and check every rule, one by one.
3. Run a code review of the diff since the last checkpoint (for example the `/code-review` skill) and fix real findings.
4. Think like an attacker for five minutes: oracle timing and staleness, market hours, rounding, swap routes and slippage, keeper abuse, liquidation, vault share price, griefing.
5. Re-read the docs touched since the last checkpoint for contradictions or stale facts.

**Record what you found.** Write findings and fixes under "Review notes" in `docs/PROGRESS.md`. A weakness you cannot fix now goes under "Known issues" with a severity (high, medium, low), and you tell the user in chat. A weakness that is a threat to user funds also goes into the threat list in `07-testing-and-security.md`.
