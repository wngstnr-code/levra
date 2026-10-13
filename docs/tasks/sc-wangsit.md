# Smart contract tasks (Wangsit)

Folder: `contracts/`, plus `packages/shared/abis/`, `addresses.ts`, `markets.ts`.

Marking: `- [ ]` not started, `- [~]` in progress, `- [x]` done. Tick the box in the same PR as the work.

Required reading before you start: 02-architecture.md, 03-interfaces.md, 04-risk-rules.md, 07-testing-and-security.md.

Tasks marked **(spike)** exist to prove an assumption. Write the result in the document named in the task, whatever the result is.

---

## M0. Foundation and spikes

- [x] **SC-01 · Set up `contracts/`**
  - Do: Foundry project; install the official Morpho interfaces, OpenZeppelin and forge-std; `forge fmt`; CI on GitHub Actions.
  - Done when: `forge build` and `forge test` pass on your own machine and on GitHub.
  - Note: Foundry project, forge-std, morpho-blue and OpenZeppelin as submodules, `forge fmt`, a Makefile, 57 tests, and a CI workflow (format, build, fork tests, ABI freshness, package checks). The first CI run on PR 5 was green.

- [~] **SC-02 · Local mainnet fork (spike)**
  - Do: a `make fork` command that runs Anvil as a copy of Monad at a fixed block number. Try reading Morpho, the Anchored oracle and token balances from that fork.
  - Done when: one test reads the QQQ price from the Anchored oracle and the state of one Morpho market on the fork, and how to run it is written in `contracts/README.md`. The answer to Q-17 is written in 09.
  - If it fails: write down why and propose another way before moving on to M1.
  - Note: done on 13 October 2026: `make fork` and `make deploy-fork` work with Anvil 1.8.3, the tests run on a fork with `--network monad`, and `script/e2e-long.sh` opens and closes a long on the fork. Q-17 is answered. Still to do: Dharu and Nabil run it on their machines.

- [x] **SC-03 · Interfaces, events and errors**
  - Do: write `ISessionOracle`, `IRiskManager`, `IMarginRouter`, `ILens`, the shared types, events and errors as defined in 03. Write a script that copies the ABIs to `packages/shared/abis/`.
  - Done when: Dharu and Nabil have read and approved it; the ABIs are in `packages/shared/abis/`; the status in 03 is changed to "frozen".
  - Note: merged as PR 1 on 13 October 2026. The contract side of the interface agreement is frozen.

- [~] **SC-04 · A real swap from a contract (spike)**
  - Do: a small test contract that swaps $5 of USDC for aQQQ and back, using calldata from the KyberSwap API, on mainnet. Read from the chain: the quote token of each pool, and the hook address of the Uniswap v4 pools for aQQQ and aHOOD.
  - Done when: the transaction hash is recorded in PROGRESS.md; 05 is updated with the quote tokens and whether a hook exists; Q-16 is answered.
  - Note: proven on a local fork: KyberSwap calldata built for the router executes from the router through the Uniswap v4 aQQQ pool, both ways. All three pools pair with USDC. The aQQQ and aHOOD pools have no hook, verified by recomputing their pool IDs, and charge a 0.90% fee. Still to do: the same swap on mainnet with real funds (comes with SC-15).

- [x] **SC-05 · Token behavior (spike)**
  - Do: read the aQQQ, aHOOD, aBIL and USDC contracts. Find out: whether they are upgradeable, whether they can be paused, how the denylist works, whether there is a fee on transfer, whether a contract may hold them, and whether USDC supports `permit`.
  - Done when: the result is written as a table in 05; Q-18 is answered; any dangerous finding is added to the threat list in 07.
  - Note: token behavior is in 05 under "Token behavior", Q-18 is answered, a transfer of aQQQ into and out of Morpho works on a fork, and the findings are in the threat list in 07 (T-07, T-08, T-17, and the new T-18 and T-19).

- [x] **SC-06 · Addresses we have not found yet (spike)**
  - Do: find and confirm on chain: the Morpho vault factory, the Morpho public allocator, Safe, Permit2, Multicall3. Also check how much USDC can be flash loaned from Morpho.
  - Done when: the addresses are in 05 and in `packages/shared/addresses.ts`; Q-11 is answered.
  - Note: both Morpho vault factories, the public allocator, Permit2, Multicall3, Safe 1.4.1 and wrapped MON are in 05 and in `packages/shared/addresses.ts`, with a test that every address is checksummed. Q-11 is answered by D-24.

---

## M1. Core long

- [~] **SC-10 · `SessionOracle` for long markets**
  - Needs: SC-03. The max age value from BE-03 is filled in at deployment, so it does not block writing the code.
  - Do: read `latestPrice` from the Anchored oracle; first check the data layout against the ABI in the block explorer; use the conservative price; scale as in 04; `snapshot()`.
  - Done when: unit tests cover scaling (one aQQQ share at $745.62 is worth 745.62 USDC according to Morpho), zero price, negative price, stale price, and a best bid of zero; a fork test reads a real price.
  - Note: written and tested: scaling, the cautious price, zero and negative price, a missing bid, staleness on both clocks (D-23). Max ages are initial proposals: 1 hour on the source quote while open, 4 days on the publish time while closed. Waiting for BE-03 data and review. Hard ages are now per market from the BE-03 data (D-35): 1 hour for QQQ and HOOD, 3 hours for BIL, 4 days while closed. Six fuzz tests in `test/OracleFuzz.t.sol` check the cautious price, the inverse relation, non-positive prices and both staleness clocks for any input.

- [~] **SC-11 · `RiskManager`**
  - Needs: SC-03.
  - Do: per-market settings; `currentSoftLtv` with the market-hours rules in 04; `checkOpen`; three roles (owner, guardian, calendar poster); a stop switch for opening positions.
  - Done when: tests cover each role and its rejections; the guardian is proven to be able to only tighten; `setNextCloseAt` rejects a time in the past and a time too far ahead; the limit changes correctly in all four states (open, pre-close window, closed, unknown).
  - Note: written and tested: soft limit in all four states, the pre-close window, position cap, deviation check, the three roles, pause. Waiting for review. Added after D-31: the oracle age poster role with owner-set bounds, tested.

- [~] **SC-12 · `MarginRouter` for long**
  - Needs: SC-10, SC-11, SC-04.
  - Do: `openLong`, `closeLong` (partial and full), `addCollateral`, `removeCollateral`; Morpho flash loan; allowlist of swap targets; fees with a hard-coded maximum; `multicall`, `permitToken`, `authorizeWithSig`; reentrancy guard; events.
  - Done when: fork tests run open, add collateral, reduce and full close against the real Morpho and KyberSwap; threats T-01, T-02, T-03, T-10, T-12 and T-17 in 07 each have a test; the router holds no tokens after each test.
  - Note: written and tested on a fork: open, add and remove collateral, partial and full close, one confirmation with two signatures, the swap target lock, the flash callback guard. Threats T-01, T-02, T-03, T-10 and T-12 have tests (`test/Security.t.sol` covers reentrancy and signature replay). T-17 is covered by measuring swap output from balances. Waiting for review. Added after D-32: `repayDebt`, tested for a partial repayment, a repayment larger than the debt, and while opening is paused.

- [~] **SC-13 · `Lens`**
  - Needs: SC-11.
  - Do: `getMarkets` and `getPositions` as defined in 03, including debt with accrued interest and the liquidation price.
  - Done when: the output matches direct reads from Morpho in the fork tests.
  - Note: written and tested against direct reads. Waiting for review.

- [~] **SC-14 · Deployment script and first market**
  - Needs: SC-10 to SC-13.
  - Do: one script that deploys the oracle, creates the aQQQ long market on Morpho (hard limit 77%), deploys `RiskManager`, the router and `Lens`, fills in the settings, and writes `contracts/deployments/<environment>.json` as defined in 03. `make fork` runs it on the local fork.
  - Done when: Dharu and Nabil can run `make fork` and get the same addresses; `packages/shared/addresses.ts` and `markets.ts` read that file.
  - Note: the script deploys everything and writes the deployment file. `packages/shared` validates that file (`deployments.ts`), reads it from disk for Node (`deployments.node.ts`) and joins it with the stock list (`markets.ts`). A test parses the real file written on a local fork. Still to do: commit `monad.json` and a static import of it after the mainnet deployment (SC-15), and Dharu and Nabil running `make fork` and `make deploy-fork`. Fork addresses match between machines only with the same `FORK_BLOCK`.

- [ ] **SC-15 · Staging on mainnet**
  - Needs: SC-14, X-03.
  - Do: deploy on mainnet with a very small position cap; fund the market with a little USDC; verify the code in the block explorer; run one real long from the script.
  - Done when: the addresses are in `deployments/monad.json`; the hashes of the open and close long transactions are recorded in PROGRESS.md.
  - Note: Prepared, not run: `make deploy-monad`, then `make first-run-monad CONFIRM=yes`, which opens and closes a long on QQQ, HOOD and BIL and a short on QQQ and HOOD and prints every transaction hash. Rehearsed on a fork with a 20 USDC wallet: 30 transactions, nothing left open. Waiting for a funded deployer wallet: about 20 MON and 20 USDC for all five markets, or 5 USDC for one long.

---

## M2. Short and Earn

- [~] **SC-20 · `SessionOracle` for short markets**
  - Needs: SC-10.
  - Do: the reverse direction as in 04 (the higher of the price and the best ask; scale `1e56 / p8`).
  - Done when: the scaling test passes; properties 1 and 4 of `SessionOracle` in 07 have tests.
  - Note: written and tested together with SC-10. Waiting for review.

- [~] **SC-21 · `MarginRouter` for short**
  - Needs: SC-12, SC-20.
  - Do: `openShort` and `closeShort` in the order given in 02; the sale proceeds are held as collateral (D-05); handling of tiny leftover stock on a full close.
  - Done when: fork tests run open, reduce and full close; a full close leaves no debt; the leftover stock reaches the user.
  - Note: written and tested on a fork with the test swapper. Also run through the live KyberSwap route with `script/e2e-short.sh`: stock bought on the exchange and lent, a short of $30 opened with $50 of margin, then closed in full with leftover stock returned and the router empty. Waiting for review.

- [~] **SC-22 · Markets for all stocks in scope**
  - Needs: SC-20, SC-21.
  - Do: aQQQ short, aHOOD long and short, aBIL long markets, with the limits in 04. Review the short soft limit (Q-15).
  - Done when: all five markets are in the staging address file; each market has one real open and close transaction recorded.
  - Note: the deployment script creates all five markets. Not deployed on mainnet yet. Q-15 is still open.

- [~] **SC-23 · USDC vault**
  - Needs: SC-06, SC-22.
  - Do: create the vault from the official Morpho factory; set the supply cap per market as in 04; the roles are held by team addresses (a multisig later); the fee share as in Q-07.
  - Done when: lending and withdrawing USDC through the vault works on staging; the vault funds really flow into our markets; the address is in the address file.
  - Note: `script/DeployVault.s.sol` creates a MetaMorpho v1.1 vault (D-24) from Morpho's factory over the long markets, with the caps from 04, a 10% fee (D-28) and a one day timelock, and records it in the deployment file. Six fork tests cover deposits reaching the market, withdrawal, the cap, the timelock and borrowers using vault liquidity. Run on a local fork. Still to do: mainnet, and moving ownership to the multisig (SC-55).

- [~] **SC-24 · Seed inventory for short markets**
  - Needs: SC-22, X-14.
  - Do: buy a little aQQQ and aHOOD, then supply them to the matching short market so there is something to borrow.
  - Done when: each short market has stock that can be borrowed; the transaction hashes are recorded.
  - Note: Prepared, not run: `make first-short-monad SYMBOL=QQQ` and `SYMBOL=HOOD` (`script/mainnet-first-short.sh`) buy the stock on the exchange and lend it to its short market, then open and close a small short. Both rehearsed on a fork. Waiting for a funded deployer wallet.

---

## M3. Market-hours protection

- [~] **SC-30 · Auto-deleverage**
  - Needs: SC-21.
  - Do: `setProtection`, `deleverage` with its three conditions; a keeper fee with a hard-coded maximum; who may call it (Q-08).
  - Done when: router properties 3 and 4 in 07 have tests; there is a malicious keeper test (T-04) that tries a bad price and fails; it works for long and short.
  - Note: written and tested: consent, keeper only (D-29), only above the soft limit, must lower the LTV, must trade near the oracle price, keeper fee capped at 0.30%. Also run through the live KyberSwap route with `script/e2e-protection.sh`: a long at 70.2% LTV in the pre-close window was reduced to 67.3%. Waiting for review.

- [~] **SC-31 · End-to-end market-hours rule tests**
  - Needs: SC-11, SC-30.
  - Do: a test that moves time forward through the pre-close window, the close and the next open, and checks the soft limit, the rejection of new positions and the `deleverage` conditions at each point.
  - Done when: the order in the "Pre-close timeline" table in 04 is proven in tests.
  - Note: `test/MarketHours.t.sol` walks one weekend in a single test: the soft limit drops four hours before the close, a new position above it is refused, the keeper reduces the protected position thirty minutes before the close, closing still works while the market is closed, and after a 5.4% gap on Monday the protected position is healthy while the unprotected one at the open limit is liquidated. Waiting for review.

- [~] **SC-32 · `Liquidator`**
  - Needs: SC-22.
  - Do: a contract that liquidates positions in our markets using the Morpho callback and a swap through KyberSwap, with no capital of its own; only the guardian address can call it; the profit goes to the team treasury.
  - Done when: fork tests make a position unhealthy (by changing the oracle price on the fork) and then liquidate it, for long and short; the ABI and address are available to Dharu.
  - Note: `Liquidator` is written and tested on a fork: a long after a 10% fall, a short after a 20% rise, refusing a loss unless told to cover it from its own float, healthy positions, keepers only, the swap target lock and the callback guard. The deployment script deploys it and records it, and `liquidatorAbi` is in `packages/shared/abis/`. Still to do: a run through the live KyberSwap route, and Dharu's bot (BE-32). Run through the live KyberSwap route with `script/e2e-liquidation.sh`: the oracle price was pushed down 12% on the fork as the Anchored operator, the position went from 70.1% to 79.7% LTV, and the liquidator brought it to 73.9% with nothing left in the contract.

---

## M4. Cross-chain deposits

- [ ] **SC-40 · Contract support for cross-chain deposits**
  - Needs: the result of BE-05.
  - Do: decide together with Dharu whether "funds arrive and open a position directly" is possible and worthwhile (Q-09). If yes, design and test the path with the same security requirements. If not, write the reason in 09.
  - Done when: Q-09 is answered in 09, and if it is built, it has tests like the other router functions.

---

## M5. Hardening

- [~] **SC-50 · Fuzz and invariant tests**
  - Do: all properties in 07 for the router, the oracle and `RiskManager`.
  - Done when: each property has a passing test with a large number of runs.
  - Note: `test/Invariants.t.sol` runs random users, a keeper and a moving price against the router on a fork and checks five properties after every call: the router holds no tokens, nobody can touch a bystander who gave every permission, no open ends above the soft limit, the soft limit stays below the hard limit, and fees stay within their caps. A campaign is 6 runs of 40 calls and takes about five minutes because it reads the chain. Still to do: more runs, a case where the keeper reduction actually succeeds inside the campaign, and invariants for the oracle on its own. Added: oracle fuzz tests without a fork, `repayDebt` and a protected reduction as campaign actions. The campaign's keeper action was repaying too little to lower the LTV, so it never succeeded and the router rightly refused it. It is fixed, a direct test (`test_handlerActionsCanSucceed`) proves the actions can succeed, and the last run logged 3 keeper reductions.

- [~] **SC-51 · Static analysis and gas report**
  - Do: Slither in GitHub Actions; a gas report per function.
  - Done when: there are no severe findings left unexplained; Dharu uses the gas numbers for the gas limits.
  - Note: `make slither` is clean with the reviewed settings in `slither.config.json`, and the reasons are in `contracts/README.md`. It led to two fixes: rounding in the `Lens` liquidation price and a reentrancy guard on `Liquidator.liquidate`. `make gas` gives the gas report and the numbers are in `contracts/README.md`. Still to do: run Slither in CI. Slither now runs in CI.

- [ ] **SC-52 · Internal review**
  - Do: read all contracts line by line, using the threat list in 07 as a checklist. Ask Dharu to read as well, as a second pair of eyes.
  - Done when: each threat from T-01 to T-17 is marked "closed, see test X" or "cannot be closed by code, see Y".

- [ ] **SC-53 · Audit preparation**
  - Needs: SC-50, SC-52, X-13.
  - Do: a document for the auditors (scope, assumptions, threats, how to run the tests); freeze the code.
  - Done when: the auditor has received the package and the audit is running.

- [ ] **SC-54 · Fix audit findings**
  - Done when: severe and medium findings are fixed and re-checked by the auditor; the final report is in the repo.

- [~] **SC-55 · Multisig and timelock**
  - Needs: SC-06, X-03.
  - Do: the owner of `RiskManager` and of the vault is a multisig behind a timelock; the guardian and calendar poster roles go to the right addresses; test that a single key cannot loosen anything.
  - Done when: no owner role is held by a single key, proven by reads from the chain.
  - Note: `script/GovernancePlan.sol` and `script/HandOver.s.sol` move ownership of the risk manager, the router and the liquidator to a timelock (2 days) that only the multisig can use, and make the multisig the guardian. Five fork tests show the deployer loses every right after the multisig accepts, loosening needs the multisig and the wait, and tightening and pausing are immediate. Still to do: a real multisig (X-03), the vault's owner, the keeper roles, and running it on mainnet. Q-27 may add one exception. D-31 adds the one exception, covered by a test: after the handover the poster can still move `maxOracleAge` inside the bounds, and widening the bounds takes the multisig and the wait. The handover now also gives the vault to the multisig, and the deployment script takes the calendar poster, the oracle age poster and the keeper from the environment.

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
