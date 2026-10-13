# 06. Team workflow

The goal of this doc: three people can work at the same time without overwriting each other, and anyone can see progress without having to ask.

## Ownership

| Folder | Owner | Who may change it |
|---|---|---|
| `contracts/` | Wangsit | Wangsit |
| `apps/api/`, `apps/indexer/`, `apps/keeper/` | Dharu | Dharu |
| `apps/web/` | Nabil | Nabil |
| `packages/shared/abis/`, `addresses.ts`, `markets.ts` | Wangsit | Wangsit; others through a PR Wangsit approves |
| `packages/shared/api/`, `math.ts`, `gaps.ts` | Dharu | Dharu; others through a PR Dharu approves |
| `docs/tasks/<part>.md` | Owner of the part | Owner of the part only |
| `docs/03-interfaces.md` | All three | PR with the `interface` label, approved by those affected |
| Other `docs/` | All three | Anyone, through a PR |

This ownership is written in the `CODEOWNERS` file so GitHub automatically asks the owner for a review (X-01).

If you find a problem in someone else's folder: do not fix it yourself. Write it in the Blockers section of PROGRESS.md or open an issue, then tell the owner.

## Branches and PRs

- Main branch: `main`. It must always build and pass tests.
- Working branch: `<part>/<task-number>-<short-name>`, for example `sc/SC-12-router-long`, `be/BE-12-quote-long`, `fe/FE-11-form-long`.
- One PR for one task, or a few small tasks of the same kind. Small PRs are reviewed faster.
- The PR title starts with the task number: `SC-12: router for opening and closing long`.
- PR to your own folder: you may merge it yourself after the automatic tests pass. For `contracts/src/`, one other person must read it before merging, because mistakes there involve money.
- A PR that touches `packages/shared/` or the interface docs: must be approved by the file owner and the people affected.
- No direct pushes to `main`.

## Changing the interface agreements

1. Write the proposal in a PR with the `interface` label: what changes, why, and who is affected.
2. That PR changes `docs/03-interfaces.md` and the source code (interface or zod schema) together.
3. Everyone affected approves.
4. After it is merged, write one line in the daily log in PROGRESS.md so nothing is missed.

Adding a new field, endpoint, or event does not break anyone and may be done quickly. Changing a name, order, or unit, or removing something, must be discussed first.

## Definition of "done" for a task

A task may only be checked off when:

1. The "Done when" condition in that task is met.
2. It has tests, and the automatic tests in the PR pass.
3. There is no mock data or half-finished part left in the product code.
4. Related docs are updated (addresses, agreements, decisions).
5. The PR is merged into `main`.

"It works on my computer" is not done.

## Reporting progress

There are two places, with different jobs:

| Place | Contents | Who changes it | When |
|---|---|---|---|
| `docs/tasks/<part>.md` | Checkbox for each task | Owner of the part | In the PR that finishes the task |
| `docs/PROGRESS.md` | Milestone status, blockers, integration checkpoints, daily log | Anyone, in their own section | When something changes |

Usage rules:

- Starting a task: change `- [ ]` to `- [~]` and push that change, so others know.
- Finished: change it to `- [x]` in the same PR as the work.
- Stuck: write it in the Blockers table the same day. Say who you are waiting for and what you are waiting for.
- End of the workday: write one to three lines in the daily log. What was finished, what is next, whether there is a blocker.

Counting progress from the terminal:

```bash
for f in docs/tasks/*.md; do
  printf "%-28s done %s, in progress %s, not started %s\n" "$f" \
    "$(grep -c '^- \[x\]' "$f")" "$(grep -c '^- \[~\]' "$f")" "$(grep -c '^- \[ \]' "$f")"
done
```

## Integration checkpoints

An integration checkpoint is when all three parts are tried together on mainnet with real money. There is one at the end of each milestone, written in [tasks/00-shared.md](tasks/00-shared.md). A milestone is not finished until its integration checkpoint passes.

How to run it: one person who did not write that part tries the flow from start to end, records the transaction hashes and everything odd, then writes it in PROGRESS.md.

## Code rules

| Item | Rule |
|---|---|
| Language | Everything in the repo is in English: file names, code, comments, commit messages and docs. Team chat can be in Indonesian. |
| Commits | Always split work into small logical commits, one concern per commit. Message format `<area>: <what changed>`, for example `sc: add soft limit check to openLong`. |
| Commit authorship | No AI tool appears as author or co-author in commits or PRs. No `Co-Authored-By` trailers and no "generated with" lines. |
| Comments | Keep code comments to a minimum. Prefer clear names. Comment only what the code cannot say, such as units or a non-obvious reason. |
| Writing style | Avoid em dashes in docs, comments and commit messages. |
| Numbers and units | Follow section 1 in 03-interfaces.md. No exceptions |
| Money math | Always integers (`bigint` in TypeScript). Never fractional numbers |
| Addresses and ABIs | Always from `packages/shared`. Never rewritten anywhere else |
| Secrets | Never go into the repo. Each app has a `.env.example` |
| Mock data | Only in test files |
| Style | Checked automatically: `forge fmt` for contracts, ESLint and Prettier for TypeScript |

## Money and keys during development

- Each person has their own development wallet, holding a little MON and USDC from the team treasury (X-03).
- The deployer key for staging may be an ordinary key. The production deployment is owned by the multisig (SC-55).
- The keeper key is held by Dharu, with only enough MON balance.
- The hash of every important real transaction is recorded in PROGRESS.md. It also serves as evidence for the competition submission.

## AI tools

The competition rules ask for AI tool use to be listed in the README. Record the tools used from the start (X-16), do not collect them at the end.

Contract code written with AI help must still be read and understood line by line by Wangsit before it is merged.

## Rhythm

| When | What |
|---|---|
| Every workday | Daily log in PROGRESS.md. No meeting needed |
| When there is a blocker | Tell the person right away, then record it |
| End of each milestone | Integration checkpoint, then a short chat: what changed from the plan, what new decisions need to be recorded in 09 |
| When someone proposes changing an agreement | Discussed by all three before the PR is merged |
