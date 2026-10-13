# CLAUDE.md

Rules for every Claude session in this repo.

The product is Levra: a margin account for tokenized stocks on Monad. One account to buy tokenized stocks with leverage (long), profit when prices fall (short), or lend assets for interest, with funds that can arrive from any chain. The goal is a final, startup-ready product. It is not an MVP and not a demo.

## 1. Start of every session (mandatory)

Do this before answering questions about the project or changing any file. Do not rely on memory from earlier sessions. The docs are the source of truth and they change.

1. Read `docs/README.md`.
2. Read `docs/PROGRESS.md`: current milestone, blockers, latest daily log entries.
3. Find out who you are working for in this session (Wangsit, Dharu or Nabil). If it is not clear from the request, ask once. Then read that person's task file in `docs/tasks/`.
4. Read `docs/03-interfaces.md` and `docs/09-decisions-and-questions.md` before touching anything that crosses areas (contract interfaces, events, API shapes, shared package).
5. Run `git log --oneline -20` and `git status` to see what changed recently.

Read the other docs when the task needs them: `01-product.md` for flows, `02-architecture.md` for structure, `04-risk-rules.md` for limits and formulas, `05-addresses-and-services.md` for addresses, `07-testing-and-security.md` before writing contract or keeper code, `08-startup-readiness.md` for launch gates.

If a doc and the code disagree, say so and fix the one that is wrong in the same piece of work.

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
- Never commit or push unless the user asks. Never push to `main` directly. Branch names: `<area>/<task-id>-<short-name>`, for example `be/BE-12-quote-long`.
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
| Wangsit | Smart contracts (SC) | `contracts/`, `packages/shared/abis/`, `addresses.ts`, `markets.ts` | `docs/tasks/sc-wangsit.md` |
| Dharu | Backend (BE) | `apps/api/`, `apps/indexer/`, `apps/keeper/`, `packages/shared/api/`, `math.ts`, `gaps.ts` | `docs/tasks/be-dharu.md` |
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
- Add blockers, real transaction hashes and a short daily log entry to `docs/PROGRESS.md`.
- Record new decisions and answered questions in `docs/09-decisions-and-questions.md`.
- Update `docs/05-addresses-and-services.md` when an address, measurement or service fact changes.
- Update `docs/03-interfaces.md` together with any interface or API change.

A task is not done until its docs are updated.

## 8. Product rules that must not be broken

- User funds stay in the user's own Morpho position. Our contracts never hold funds between transactions.
- Closing, reducing and adding collateral can never be paused.
- Auto-deleverage is opt-in per user and per market.
- The hard limit uses the Anchored oracle only. DEX prices are used only in the soft layer.
- All limits in `docs/04-risk-rules.md` are initial proposals. Do not present them as tested or safe.
- Mark facts honestly: verified, not verified, or initial proposal. Never state a not-verified item as fact.
