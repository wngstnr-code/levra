# Smart contract tasks (Wangsit)

Folder: `contracts/`, plus `packages/shared/abis/`, `addresses.ts`, `markets.ts`.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 02-architecture.md, 03-interfaces.md, 04-risk-rules.md, 07-testing-and-security.md.

Tasks marked **(spike)** exist to prove an assumption. Write the result in the document named in the task, whatever the result is.

---

## M0. Foundation and spikes

- [~] **SC-01 · Set up `contracts/`**
  - Do: Foundry project; install the official Morpho interfaces, OpenZeppelin and forge-std; `forge fmt`; CI on GitHub Actions.
  - Done when: `forge build` and `forge test` pass on your own machine and on GitHub.
  - Note: partly done with SC-03: Foundry project, forge-std and morpho-blue as submodules, `forge fmt`, a Makefile. Still to do: OpenZeppelin, a first test, and CI on GitHub Actions.

- [~] **SC-02 · Local mainnet fork (spike)**
  - Do: a `make fork` command that runs Anvil as a copy of Monad at a fixed block number. Try reading Morpho, the Anchored oracle and token balances from that fork.
  - Done when: one test reads the QQQ price from the Anchored oracle and the state of one Morpho market on the fork, and how to run it is written in `contracts/README.md`. The answer to Q-17 is written in 09.
  - If it fails: write down why and propose another way before moving on to M1.
  - Note: a quick check showed Anvil 1.8.3 forks Monad and that reads and an impersonated `approve` work. Still to do: the `make fork` command, the fork test in the repo, and a full swap and Morpho flow on the fork.

- [x] **SC-03 · Interfaces, events and errors**
  - Do: write `ISessionOracle`, `IRiskManager`, `IMarginRouter`, `ILens`, the shared types, events and errors as defined in 03. Write a script that copies the ABIs to `packages/shared/abis/`.
  - Done when: Dharu and Nabil have read and approved it; the ABIs are in `packages/shared/abis/`; the status in 03 is changed to "frozen".
  - Note: merged as PR 1 on 13 October 2026. The contract side of the interface agreement is frozen.

- [ ] **SC-04 · A real swap from a contract (spike)**
  - Do: a small test contract that swaps $5 of USDC for aQQQ and back, using calldata from the KyberSwap API, on mainnet. Read from the chain: the quote token of each pool, and the hook address of the Uniswap v4 pools for aQQQ and aHOOD.
  - Done when: the transaction hash is recorded in PROGRESS.md; 05 is updated with the quote tokens and whether a hook exists; Q-16 is answered.

- [~] **SC-05 · Token behavior (spike)**
  - Do: read the aQQQ, aHOOD, aBIL and USDC contracts. Find out: whether they are upgradeable, whether they can be paused, how the denylist works, whether there is a fee on transfer, whether a contract may hold them, and whether USDC supports `permit`.
  - Done when: the result is written as a table in 05; Q-18 is answered; any dangerous finding is added to the threat list in 07.
  - Note: read from chain on 13 October 2026 and written up in 05 under "Token behavior": the stock tokens are beacon proxies with a compliance contract and no `permit`; USDC has `permit`, a pauser and a blacklist; Morpho is not on the denylist. Still to do: confirm which compliance check a plain transfer uses, simulate a transfer to Morpho, and add findings to the threat list in 07.

- [~] **SC-06 · Addresses we have not found yet (spike)**
  - Do: find and confirm on chain: the Morpho vault factory, the Morpho public allocator, Safe, Permit2, Multicall3. Also check how much USDC can be flash loaned from Morpho.
  - Done when: the addresses are in 05 and in `packages/shared/addresses.ts`; Q-11 is answered.
  - Note: addresses found in Morpho's SDK address list and confirmed to have code on chain: both vault factories, the public allocator, Permit2, Multicall3 and Safe 1.4.1. They are in 05. Still to do: add them to `packages/shared/addresses.ts`, and decide the vault type (Q-11).

---

## M1. Core long

- [ ] **SC-10 · `SessionOracle` for long markets**
  - Needs: SC-03. The max age value from BE-03 is filled in at deployment, so it does not block writing the code.
  - Do: read `latestPrice` from the Anchored oracle; first check the data layout against the ABI in the block explorer; use the conservative price; scale as in 04; `snapshot()`.
  - Done when: unit tests cover scaling (one aQQQ share at $745.62 is worth 745.62 USDC according to Morpho), zero price, negative price, stale price, and a best bid of zero; a fork test reads a real price.

- [ ] **SC-11 · `RiskManager`**
  - Needs: SC-03.
  - Do: per-market settings; `currentSoftLtv` with the market-hours rules in 04; `checkOpen`; three roles (owner, guardian, calendar poster); a stop switch for opening positions.
  - Done when: tests cover each role and its rejections; the guardian is proven to be able to only tighten; `setNextCloseAt` rejects a time in the past and a time too far ahead; the limit changes correctly in all four states (open, pre-close window, closed, unknown).

- [ ] **SC-12 · `MarginRouter` for long**
  - Needs: SC-10, SC-11, SC-04.
  - Do: `openLong`, `closeLong` (partial and full), `addCollateral`, `removeCollateral`; Morpho flash loan; allowlist of swap targets; fees with a hard-coded maximum; `multicall`, `permitToken`, `authorizeWithSig`; reentrancy guard; events.
  - Done when: fork tests run open, add collateral, reduce and full close against the real Morpho and KyberSwap; threats T-01, T-02, T-03, T-10, T-12 and T-17 in 07 each have a test; the router holds no tokens after each test.

- [ ] **SC-13 · `Lens`**
  - Needs: SC-11.
  - Do: `getMarkets` and `getPositions` as defined in 03, including debt with accrued interest and the liquidation price.
  - Done when: the output matches direct reads from Morpho in the fork tests.

- [ ] **SC-14 · Deployment script and first market**
  - Needs: SC-10 to SC-13.
  - Do: one script that deploys the oracle, creates the aQQQ long market on Morpho (hard limit 77%), deploys `RiskManager`, the router and `Lens`, fills in the settings, and writes `contracts/deployments/<environment>.json` as defined in 03. `make fork` runs it on the local fork.
  - Done when: Dharu and Nabil can run `make fork` and get the same addresses; `packages/shared/addresses.ts` and `markets.ts` read that file.

- [ ] **SC-15 · Staging on mainnet**
  - Needs: SC-14, X-03.
  - Do: deploy on mainnet with a very small position cap; fund the market with a little USDC; verify the code in the block explorer; run one real long from the script.
  - Done when: the addresses are in `deployments/monad.json`; the hashes of the open and close long transactions are recorded in PROGRESS.md.

---

## M2. Short and Earn

- [ ] **SC-20 · `SessionOracle` for short markets**
  - Needs: SC-10.
  - Do: the reverse direction as in 04 (the higher of the price and the best ask; scale `1e56 / p8`).
  - Done when: the scaling test passes; properties 1 and 4 of `SessionOracle` in 07 have tests.

- [ ] **SC-21 · `MarginRouter` for short**
  - Needs: SC-12, SC-20.
  - Do: `openShort` and `closeShort` in the order given in 02; the sale proceeds are held as collateral (D-05); handling of tiny leftover stock on a full close.
  - Done when: fork tests run open, reduce and full close; a full close leaves no debt; the leftover stock reaches the user.

- [ ] **SC-22 · Markets for all stocks in scope**
  - Needs: SC-20, SC-21.
  - Do: aQQQ short, aHOOD long and short, aBIL long markets, with the limits in 04. Review the short soft limit (Q-15).
  - Done when: all five markets are in the staging address file; each market has one real open and close transaction recorded.

- [ ] **SC-23 · USDC vault**
  - Needs: SC-06, SC-22.
  - Do: create the vault from the official Morpho factory; set the supply cap per market as in 04; the roles are held by team addresses (a multisig later); the fee share as in Q-07.
  - Done when: lending and withdrawing USDC through the vault works on staging; the vault funds really flow into our markets; the address is in the address file.

- [ ] **SC-24 · Seed inventory for short markets**
  - Needs: SC-22, X-14.
  - Do: buy a little aQQQ and aHOOD, then supply them to the matching short market so there is something to borrow.
  - Done when: each short market has stock that can be borrowed; the transaction hashes are recorded.

---

## M3. Market-hours protection

- [ ] **SC-30 · Auto-deleverage**
  - Needs: SC-21.
  - Do: `setProtection`, `deleverage` with its three conditions; a keeper fee with a hard-coded maximum; who may call it (Q-08).
  - Done when: router properties 3 and 4 in 07 have tests; there is a malicious keeper test (T-04) that tries a bad price and fails; it works for long and short.

- [ ] **SC-31 · End-to-end market-hours rule tests**
  - Needs: SC-11, SC-30.
  - Do: a test that moves time forward through the pre-close window, the close and the next open, and checks the soft limit, the rejection of new positions and the `deleverage` conditions at each point.
  - Done when: the order in the "Pre-close timeline" table in 04 is proven in tests.

- [ ] **SC-32 · `Liquidator`**
  - Needs: SC-22.
  - Do: a contract that liquidates positions in our markets using the Morpho callback and a swap through KyberSwap, with no capital of its own; only the guardian address can call it; the profit goes to the team treasury.
  - Done when: fork tests make a position unhealthy (by changing the oracle price on the fork) and then liquidate it, for long and short; the ABI and address are available to Dharu.

---

## M4. Cross-chain deposits

- [ ] **SC-40 · Contract support for cross-chain deposits**
  - Needs: the result of BE-05.
  - Do: decide together with Dharu whether "funds arrive and open a position directly" is possible and worthwhile (Q-09). If yes, design and test the path with the same security requirements. If not, write the reason in 09.
  - Done when: Q-09 is answered in 09, and if it is built, it has tests like the other router functions.

---

## M5. Hardening

- [ ] **SC-50 · Fuzz and invariant tests**
  - Do: all properties in 07 for the router, the oracle and `RiskManager`.
  - Done when: each property has a passing test with a large number of runs.

- [ ] **SC-51 · Static analysis and gas report**
  - Do: Slither in GitHub Actions; a gas report per function.
  - Done when: there are no severe findings left unexplained; Dharu uses the gas numbers for the gas limits.

- [ ] **SC-52 · Internal review**
  - Do: read all contracts line by line, using the threat list in 07 as a checklist. Ask Dharu to read as well, as a second pair of eyes.
  - Done when: each threat from T-01 to T-17 is marked "closed, see test X" or "cannot be closed by code, see Y".

- [ ] **SC-53 · Audit preparation**
  - Needs: SC-50, SC-52, X-13.
  - Do: a document for the auditors (scope, assumptions, threats, how to run the tests); freeze the code.
  - Done when: the auditor has received the package and the audit is running.

- [ ] **SC-54 · Fix audit findings**
  - Done when: severe and medium findings are fixed and re-checked by the auditor; the final report is in the repo.

- [ ] **SC-55 · Multisig and timelock**
  - Needs: SC-06, X-03.
  - Do: the owner of `RiskManager` and of the vault is a multisig behind a timelock; the guardian and calendar poster roles go to the right addresses; test that a single key cannot loosen anything.
  - Done when: no owner role is held by a single key, proven by reads from the chain.

- [ ] **SC-56 · Bug bounty program**
  - Do: scope, reward levels, how to report.
  - Done when: the page is published and linked from the app.

---

## M6. Launch

- [ ] **SC-60 · Production deployment**
  - Needs: SC-54, SC-55, Q-07 answered.
  - Do: deploy the audited code with the final numbers; verify in the block explorer; fill the markets with seed funds.
  - Done when: `deployments/monad.json` holds the production addresses; all contracts are verified; one full round (open, close, long, short, Earn) is run in production and recorded.

- [ ] **SC-61 · Public contract documentation**
  - Do: the list of addresses, an explanation of the roles and of what the team can and cannot do, how to revoke the Morpho authorization without our app, a link to the audit report.
  - Done when: published on the Help page and in the README.
