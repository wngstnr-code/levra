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

- [x] **SC-04 · A real swap from a contract (spike)**
  - Do: a small test contract that swaps $5 of USDC for aQQQ and back, using calldata from the KyberSwap API, on mainnet. Read from the chain: the quote token of each pool, and the hook address of the Uniswap v4 pools for aQQQ and aHOOD.
  - Done when: the transaction hash is recorded in PROGRESS.md; 05 is updated with the quote tokens and whether a hook exists; Q-16 is answered.
  - Note: proven on a local fork: KyberSwap calldata built for the router executes from the router through the Uniswap v4 aQQQ pool, both ways. All three pools pair with USDC. The aQQQ and aHOOD pools have no hook, verified by recomputing their pool IDs, and charge a 0.90% fee. The same swaps then ran on mainnet from the router in the first run of SC-15: stock bought and sold for all three stocks, hashes in PROGRESS.md.

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
  - Note: the script deploys everything and writes the deployment file. `packages/shared` validates that file (`deployments.ts`), reads it from disk for Node (`deployments.node.ts`) and joins it with the stock list (`markets.ts`). A test parses the real file written on a local fork. `monad.json` is committed and `deployments.monad.ts` bundles it for the browser. Still to do: Dharu and Nabil running `make fork` and `make deploy-fork`. Fork addresses match between machines only with the same `FORK_BLOCK`.

- [x] **SC-15 · Staging on mainnet**
  - Needs: SC-14, X-03.
  - Do: deploy on mainnet with a very small position cap; fund the market with a little USDC; verify the code in the block explorer; run one real long from the script.
  - Done when: the addresses are in `deployments/monad.json`; the hashes of the open and close long transactions are recorded in PROGRESS.md.
  - Note: deployed on 13 October 2026 with `make deploy-monad`: 25 transactions, all successful, 1.87 MON. The addresses are in `deployments/monad.json` and the hashes are in PROGRESS.md. Read back from the chain: owner, fees, the five market configs, oracle age bounds and oracle prices match the plan. The source of all nine contracts is verified on Sourcify and on MonadVision's Sourcify instance (exact match). The owner is the deployer wallet until the handover (SC-55). Keeper, calendar poster and oracle age poster were granted on 14 October 2026 with `make set-roles-monad` (`script/mainnet-set-roles.sh`, rehearsed on a fork), with a separate keeper for the router and for the `Liquidator`; hashes in PROGRESS.md. The first run followed the same day with `make first-run-monad CONFIRM=yes` at the 15 USDC sizes: 30 transactions, all successful, every position closed, hashes in PROGRESS.md.

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

- [x] **SC-22 · Markets for all stocks in scope**
  - Needs: SC-20, SC-21.
  - Do: aQQQ short, aHOOD long and short, aBIL long markets, with the limits in 04. Review the short soft limit (Q-15).
  - Done when: all five markets are in the staging address file; each market has one real open and close transaction recorded.
  - Note: all five markets are deployed on mainnet and listed in `deployments/monad.json`. Each has one real open and one real full close, recorded in PROGRESS.md. Q-15 (the short soft limit) is still open.

- [x] **SC-23 · USDC vault**
  - Needs: SC-06, SC-22.
  - Do: create the vault from the official Morpho factory; set the supply cap per market as in 04; the roles are held by team addresses (a multisig later); the fee share as in Q-07.
  - Done when: lending and withdrawing USDC through the vault works on staging; the vault funds really flow into our markets; the address is in the address file.
  - Note: `script/DeployVault.s.sol` creates a MetaMorpho v1.1 vault (D-24) from Morpho's factory over the long markets, with the caps from 04, a 10% fee (D-28) and a one day timelock, and records it in the deployment file. Six fork tests cover deposits reaching the market, withdrawal, the cap, the timelock and borrowers using vault liquidity. Run on a local fork. Deployed on mainnet on 13 October 2026 at `0xfB99A7E3f5571baA363d67F7823bb354cfd95447` and recorded in `deployments/monad.json`. Read back from the chain: name, asset, the three caps, the supply queue, fee, fee recipient and timelock match the plan. A real deposit and withdrawal ran on mainnet the same day with `make first-earn-monad`: 1 USDC went in, the vault lent all of it to the QQQ long market, and 1 USDC came back in full. Hashes are in PROGRESS.md. Ownership moves to the multisig with SC-55.

- [x] **SC-24 · Seed inventory for short markets**
  - Needs: SC-22, X-14.
  - Do: buy a little aQQQ and aHOOD, then supply them to the matching short market so there is something to borrow.
  - Done when: each short market has stock that can be borrowed; the transaction hashes are recorded.
  - Note: done on mainnet in the first run of SC-15. About 2 USDC of stock was bought on the exchange for each short market and lent to it: 0.00273 aQQQ and 0.01705 aHOOD. Hashes are in PROGRESS.md. These are test amounts. Real seed sizes wait for X-14.

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

- [x] **SC-52 · Internal review**
  - Do: read all contracts line by line, using the threat list in 07 as a checklist. Ask Dharu to read as well, as a second pair of eyes.
  - Done when: each threat from T-01 to T-17 is marked "closed, see test X" or "cannot be closed by code, see Y".
  - Note: on 20 November 2026 an automated high effort review of all of `contracts/src` found 8 issues, all fixed with tests (D-89, D-90; PROGRESS review notes). The threat list gained T-24. Two more rounds followed (D-91 to D-93). On 20 November 2026 Dharu and Nabil read `contracts/src` as the human second readers and reported no findings (reported by Wangsit; no written notes). The threat pass is done (07, "Threat pass"): 9 threats closed by tests, 4 closed for their code part with the rest off chain, 11 not closable by code with where they are handled. Gap: no fee on transfer test (T-17, known issue, low).

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
  - Note: `script/GovernancePlan.sol` and `script/HandOver.s.sol` move ownership of the risk manager, the router and the liquidator to a timelock (2 days) that only the multisig can use, and make the multisig the guardian. Five fork tests show the deployer loses every right after the multisig accepts, loosening needs the multisig and the wait, and tightening and pausing are immediate. Still to do: a real multisig (X-03), the vault's owner, the keeper roles, and running it on mainnet. Q-27 may add one exception. D-31 adds the one exception, covered by a test: after the handover the poster can still move `maxOracleAge` inside the bounds, and widening the bounds takes the multisig and the wait. The handover now also gives the vault to the multisig, and the deployment script takes the calendar poster, the oracle age poster and the keeper from the environment. Base on 22 November 2026: handover sent (timelock `0xA0089B68a8CFf4d810985DF8503815b3d1344c67`, PR #114); waiting for the Safe to schedule and, 2 days later, execute `acceptOwnership`. X Layer the same day: handover sent (timelock `0xce171c460929433640f58dC5d3e9746Db00b420e`, PR #116), same next steps.

- [~] **SC-56 · Bug bounty program**
  - Do: scope, reward levels, how to report.
  - Done when: the page is published and linked from the app.
  - Note: drafted in `docs/drafts/bug-bounty.md`: scope, severity levels with examples, report contents, rules and response times. Not published. Still to do: reward amounts and the private reporting channel (Q-29), review of the legal sentence by counsel (X-10), and the link from the app.

---

## M6. Launch

- [ ] **SC-60 · Production deployment**
  - Needs: SC-54, SC-55, Q-07 answered.
  - Do: deploy the audited code with the final numbers; verify in the block explorer; fill the markets with seed funds.
  - Done when: `deployments/monad.json` holds the production addresses; all contracts are verified; one full round (open, close, long, short, Earn) is run in production and recorded.

- [~] **SC-61 · Public contract documentation**
  - Do: the list of addresses, an explanation of the roles and of what the team can and cannot do, how to revoke the Morpho authorization without our app, a link to the audit report.
  - Done when: published on the Help page and in the README.
  - Note: written in `docs/public/contracts.md` from the deployed code: addresses, market IDs, what nobody can change, the five roles and who holds them today, what the owner can and cannot do, the protection rules, how to revoke the Morpho authorization and close directly on Morpho, and the risks outside our contracts. The root README lists the addresses and links to it. Still to do: the Help page (Nabil, FE), and the audit link when there is a report.

---

## B. Base (Stocks Maxxing)

Plan and reasons: [11-base-stocksmaxxing.md](../11-base-stocksmaxxing.md). Deadline for the submission: 5 December 2026.

- [x] **SC-70 · Base addresses and facts**
  - Do: read and write into 05 a new "Base" section: Morpho core, IRM, vault factories and the existing stock markets (IDs, LLTV), USDC, every Coinbase B20 stock token, Chainlink feed per stock, Coinbase oracle registry, Permit2, Multicall3, Safe. Mark each verified or not.
  - Done when: every address has code on Base mainnet, read on a stated date, and is in 05.
  - Note: done on 19 November 2026 from the chain, the Morpho API, Sourcify and the docs (05, Base): Morpho core, IRM, both MetaMorpho factories, Vault V2 factory, both public allocators, USDC, Permit2, Multicall3, Safe 1.4.1, the Coinbase oracle registry, and 8 stock tokens with listed Morpho long markets and their Chainlink feeds. The B20 policy registry, token factory and supply manager came from `api.coinbase.com` (blocked on our network, read over another connection). Left out: the token addresses for MSTR and SNDK, which have feeds but no Morpho market; finding them needs the factory's `SecurityTokenDeployed` logs from an archive RPC.

- [x] **SC-71 · B20 policy check**
  - Do: for each stock, read `policyExists` and `isAuthorized` for Morpho, the router, the liquidator, the 1inch router, the Aerodrome router and a plain wallet, in every scope including the transfer executor (D-72). Check pause state. Write a fork test that moves each token through Morpho and the router.
  - Done when: the result per token is in 05 and Q-36 is answered. Tokens that block our contracts are not listed.
  - Note: done on 19 November 2026 on branch `sc/SC-71-b20-policy` (stacked on SC-73): all 8 stocks use policy 5, a blocklist, for all three transfer scopes, none is paused, and Morpho, the 1inch and Aerodrome routers and fresh addresses are authorized (05, Base). Q-36 answered, all 8 stay listed. The fork test is replaced by `packages/shared/b20-policy.live.test.ts`, because a local fork cannot run B20 precompiles: it reads the live node and moves each token through Morpho and every swap router with `eth_simulateV1` (32 checks pass). Policy 5 has a single key admin, recorded as T-21. Run the check again with our addresses after SC-76. Rechecked on 21 November 2026 before the deployment: still 32 of 32, same policy admin, deployer and Safe authorized (05). Run with the deployed addresses on 22 November 2026: 32 of 32, router, liquidator, risk manager, lens and Safe authorized under policy 5 (05).

- [x] **SC-72 · `ChainlinkSessionOracle`**
  - Needs: SC-70.
  - Do: an adapter behind `ISessionOracle` that reads the Coinbase Chainlink feed (8 decimals) and the registry pause flag, scales to our price units (03 section 1), and reports a frozen or halted market. Fuzz and fork tests. Update 04 and the product rule in CLAUDE.md (D-49) in the same PR.
  - Done when: ABI exported to `packages/shared/abis/`, tests pass on a Base fork, docs updated.
  - Note: written on 19 November 2026 on branch `sc/SC-71-b20-policy` (to be split into its own PR). `ChainlinkSessionOracle` reads the feed and the Coinbase registry, closes Saturday 00:00 to Monday 01:00 UTC, treats a pause or an unreadable registry (gas capped at 100,000) as "no new positions, price on the closed clock", and rejects answers outside its own bounds. 11 unit and fuzz tests, 3 Base fork tests: it matches Morpho's own NVDAc oracle on a weekday and over the weekend. ABIs exported (`chainlinkSessionOracleAbi`, `chainlinkFeedAbi`, `coinbaseOracleRegistryAbi`). Base forks run under `--network optimism`, apart from the Monad suite (Makefile and CI). Slither clean. 04 and 03 updated; the rules are agreed as D-76. The CLAUDE.md rule was already updated with D-49. Found SC-86 on the way.

- [x] **SC-73 · Chain keyed shared package**
  - Contract: D-60.
  - Do: `packages/shared` gets `chains.ts`; `addresses.ts`, `markets.ts` and deployments become keyed by chain ID; Monad stays the default. Follow the interface change process in 06 with Dharu and Nabil.
  - Done when: API, keeper and web still build and pass tests on Monad with the new shape.
  - Note: written on branch `sc/SC-73-chain-keyed-shared` on 19 November 2026, additive only: `chains.ts` (Monad and Base), `externalByChain`, `tokensByChain`, `stocksByChain` with the 8 Base stocks, and chain aware `listMarkets`. The Monad exports are unchanged. Typecheck and tests pass in all 8 packages (shared 88 tests). `next build` for web compiles and renders every page locally and passes on Vercel. Merged as PR 84 on 19 November 2026.

- [x] **SC-74 · Base risk limits**
  - Needs: SC-70, BE-71.
  - Do: initial proposals in 04 for Base: LLTV of the new short markets, position caps from Aerodrome depth, max oracle age per session (24 hour heartbeat), weekend behaviour, issuer block or pause risk.
  - Done when: 04 has a Base table marked "initial proposal" and Dharu has checked it against `math.ts`.
  - Note: proposed on 19 November 2026 in 04 "Base limits": hard limits 77% (MSFT, GOOGL, META, AMZN, AAPL) and 62.5% (TSLA, NVDA, SPCX), closed soft limits that pass the five-year weekend gap check for long and short, oracle ages (36 hours open, 4 days closed, 26 hours to open), price bounds, deviation limits, position caps ($1,000 to $5,000) and supply caps. Gap data from the BE-34 code for the eight Base stocks; sell costs up to $50,000 from 1inch. SPCX has too little history and borrows NVDA's worst drop. Done on 20 November 2026: Dharu's BE-92 test (`packages/shared/limits.test.ts`) recomputes the Base and X Layer tables with `math.ts` and finds no difference, and BE-93 added the Base stocks to `gapTable` with rows equal to 04.

- [x] **SC-75 · Swap allowlist for 1inch and Aerodrome**
  - Needs: BE-71.
  - Do: add the 1inch router and the Aerodrome router to the router allowlist on Base (D-72); Monad keeps KyberSwap until BE-71 shows 1inch routes Anchored stocks. Fork test a long and a short through each Base route.
  - Done when: both tests pass.
  - Note: D-79 changes the plan: there is no allowlist to add to after deployment. On 19 November 2026 the router and the liquidator gained `SwapTargets`, one to three targets set in the constructor, on branch `sc/D-79-swap-targets` (`test/SwapTargets.t.sol`: limits, refusals, a swap through the second target, the liquidator). SC-75 is now: pass the three Base targets of D-80 (1inch, KyberSwap, Aero SwapRouter) to the Base deployment (SC-76), and test a long and a short through each route once BE-71 gives calldata. B20 stocks cannot move on a fork, so that test runs as a live simulation. Done on 19 November 2026: `make base-live-e2e` deploys `script/live/BaseLiveHarness.sol` inside an `eth_simulateV1` run on the live Base node, then opens and closes an NVDAc long (1inch in, Aero out) and short (KyberSwap in, 1inch out). Every position ends at zero and the router holds nothing (05). The KyberSwap public API works on Base without a key.

- [~] **SC-76 · Deploy on Base**
  - Needs: SC-71, SC-72, SC-74, SC-75.
  - Do: deploy the router, risk manager, oracle adapter, lens and liquidator; create the long markets (collateral stock, loan USDC, D-77) and the short markets (collateral USDC, loan stock) with `ChainlinkSessionOracle`, and the Earn vaults; write `deployments.base.ts`; hand ownership to the multisig on Base.
  - Done when: deployment file merged, contracts verified on Basescan, addresses in 05 and `docs/public/contracts.md`.
  - Note: part 1 written on 19 November 2026. `Deploy.s.sol` and `DeployVault.s.sol` now read `contracts/config/<chain>.json`; `config/monad.json` reproduces the live Monad plan (test), `config/base.json` holds the 16 Base markets with the SC-74 limits and the D-80 swap targets. On a Base fork the script creates all 16 markets and the MetaMorpho vault over the 8 longs; `make deploy-base-dry` simulates the whole deployment on the live chain (about 32 million gas, under 0.001 ETH) without writing a file. `packages/shared/deploy-config.test.ts` ties every config address to the shared package. Part 2 (the real deployment, Basescan verification, `deployments.base.ts`, hand over to the multisig) waits for a funded deployer on Base, the multisig addresses, and Dharu's check of SC-74. Part 2 on 22 November 2026: deployed on Base mainnet (05, PROGRESS), all 20 contracts verified on Basescan and Sourcify, `deployments.base.ts` in PR #112. #112 merged. Earn vault `0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8` deployed the same day, PR #113. Left: merge #113 and the handover to the Safe (SC-55).

- [ ] **SC-77 · Seed the short markets**
  - Needs: SC-76, X-31.
  - Do: supply the team's seed stocks to the short markets and seed USDC to the long side vault (amounts in D-70). Script it like `make first-run-monad`.
  - Done when: real transaction hashes in PROGRESS.

- [ ] **SC-78 · First real long and short on Base**
  - Needs: SC-77.
  - Do: one long and one short on each listed stock with small size, then close.
  - Done when: hashes in PROGRESS. This is checkpoint I-B1 together with FE-72.


---

- [~] **SC-88 · Issuer control ABIs in the shared package**
  - Needs: request from Dharu (BE-75, BE-30), 22 November 2026.
  - Do: export to `packages/shared/abis` the Anchored compliance `isDenylisted`, Circle USDC `paused` and `isBlacklisted`, B20 `policyId` and `isPaused`, the B20 policy registry `isAuthorized`, xStock `isPaused` and `asset`, the sanctions list `isSanctioned`, and `RiskManager.calendarPoster`.
  - Done when: the keeper can import them instead of the inline ABIs in `apps/keeper/src/monitor/gates.ts` and `calendar/poster.ts`, and shared tests pass.
  - Note: PR #120 on 22 November 2026. Six interfaces in `contracts/src/interfaces/` exported by `make abis` as `anchoredComplianceAbi`, `circleTokenAbi`, `b20TokenAbi`, `b20PolicyRegistryAbi`, `xStockAbi`, `sanctionsListAbi`, plus `morphoOracleAbi` (Morpho `IOracle`). `calendarPoster` and `isKeeper` were already in `riskManagerAbi` and `marginRouterAbi`. `issuer-abis.test.ts` pins the signatures; 128 shared tests pass. Done when #120 merges.

- [~] **SC-89 · No token as swap target or spender**
  - Needs: BE-94 finding 3.
  - Do: the deploy scripts refuse a swap target or spender that is USDC or a stock of the deployment, before anything is created.
  - Done when: `Deploy.s.sol` and `RedeployRouter.s.sol` check it, a test covers a bad config and every live config, and the PR is merged.
  - Note: written on 22 November 2026 on branch `sc/SC-89-swap-target-guard` (`script/SwapTargetGuard.sol`, `test/SwapTargetGuard.t.sol`, 5 tests). The full suite passes.

## X. X Layer (TapeOut Accelerate)

Plan and reasons: [12-xlayer-tapeout.md](../12-xlayer-tapeout.md). Deadline for the submission: 7 December 2026, 23:59 UTC.

- [x] **SC-80 · X Layer addresses and facts**
  - Needs: SC-73 for the shared package part.
  - Do: add an "X Layer" section to 05: Morpho core, IRM, vault factories, the xStocks markets (IDs, LLTV, oracle, which USDC they lend), every wrapped xStocks token, USDC native and USDC.e, Permit2, Multicall3, Safe. Add X Layer (196) to `packages/shared` chains, addresses and markets.
  - Done when: every address has code on X Layer, is in 05 with a read date, and the shared package builds.
  - Note: done on 19 November 2026: 05 has an X Layer infrastructure table (Morpho core, IRM, oracle and Vault V2 factories, adapters, registry, public allocator, bundles, native USDC, a second USDC that may be USDC.e, USDT, WOKB, Permit2, Multicall3, Safe), all with code at block 76329283. `packages/shared` has chain 196 (`xlayer`), `xlayerExternal`, `xlayerTokens` and `xlayerStocks`; `morphoVaultFactory` is no longer a core key, because X Layer has no MetaMorpho factory. All 8 packages typecheck and test. Opened Q-44 (Earn vault on X Layer) and Q-45 (X Layer long markets).

- [x] **SC-81 · xStocks oracle check**
  - Needs: SC-80.
  - Do: find who runs the `wNVDAx-USD (Calculated)` style feeds (aggregator owner, vendor docs), their heartbeat, deviation and weekend behaviour. Log a week of updates with BE-03's logger if needed. Check token transfer rules of the wrapped xStocks (denylist, pause) for Morpho, the router and the liquidator.
  - Done when: findings in 05 and Q-37 answered. If the feed is not an official one, raise it to the team before SC-82.
  - Note: done on 19 November 2026 from the chain (05, X Layer): the four feeds are Chainlink style OCR2 aggregators owned by one 4 of 9 Safe, update every 1 to 3 minutes and stop from Friday 20:00 to Sunday 20:00 ET; `minAnswer` is 1. wNVDAx wrapper and underlying are pausable upgradeable proxies, the underlying has a sanctions list. Team decision in D-69. The rest done later on 19 November 2026 on the SC-71 branch: Q-42 answered (the same Safe owns Chainlink's own X Layer feeds), the other three tokens share the same code, admins, pauser and sanctions list, and `test/XStocks.t.sol` moves each through Morpho and stand-ins for the router and liquidator on a fork. The sanctions list also blocks the wrapped token (T-23).

- [x] **SC-82 · Oracle adapter and limits for X Layer**
  - Needs: SC-72, SC-81, BE-81.
  - Do: reuse `ChainlinkSessionOracle` (SC-72) for the xStocks feeds, without the Coinbase multiplier and registry parts. Treat Friday 20:00 to Sunday 20:00 ET as frozen and reject prices outside our own bounds (D-69). Initial proposals in 04 for X Layer: short market LLTV, caps from DEX depth, max oracle age per session.
  - Done when: fork tests pass on X Layer and 04 has an X Layer table marked "initial proposal".
  - Note: groundwork on 20 November 2026. OKX DEX API v6 works for chain 196 (key, secret, passphrase; no project ID) and quotes route through Uniswap v3 and v4. OKX pulls tokens through a separate approve contract, so `SwapTargets` now keeps a fixed spender per target (D-88, tests in `SwapTargets.t.sol`; the Base live test still passes). Done the same day: OKX DEX swap costs per size for the four stocks (05), the X Layer limits in 04, `contracts/config/xlayer.json` (8 markets, OKX DEX with its approve contract and Uniswap SwapRouter02 as targets, no registry), and `DeployXLayerForkTest`: the deployment runs on an X Layer fork and our wNVDAx oracle answers exactly what Morpho's own oracle answers. Still open for SC-83: a full long and short on an X Layer fork with a real OKX swap through our router.

- [~] **SC-83 · Deploy on X Layer**
  - Needs: SC-82.
  - Do: deploy router, risk manager, oracle adapter, lens and liquidator; add the OKX DEX router to the allowlist; create the short markets and Earn vaults; write `deployments.xlayer.ts`; hand ownership to the multisig on X Layer.
  - Done when: contracts verified on the X Layer explorer, addresses in 05 and `docs/public/contracts.md`.
  - Note: rehearsed on 20 November 2026 with `make xlayer-fork-e2e`: the deployment script with `config/xlayer.json` runs on an X Layer fork, an NVDA long opens and closes through OKX DEX, and a QQQ short opens through Uniswap and closes through OKX DEX, with the router empty at the end (05). The real deployment waits for OKB for gas, the multisig on X Layer, and Dharu's check of the SC-82 limits. The OKX DEX router and its approve contract are fixed in the config (D-85, D-88). Deployed on mainnet on 22 November 2026 (05, PROGRESS), Sourcify 12 of 12, PR #115 for `xlayer.json` and `deployments.xlayer.ts`. No vault on X Layer (D-84). Left: the OKX explorer check, merge #115, and the handover (SC-55).

- [ ] **SC-84 · Seed and first real trades on X Layer**
  - Needs: SC-83, X-35.
  - Do: seed the short markets and the vault (amounts in D-70), then one long and one short per listed stock with small size, then close.
  - Done when: hashes in PROGRESS (checkpoint I-X1 with FE-80).

- [ ] **SC-85 · Review the TapeOut risk circuit**
  - Needs: BE-83.
  - Do: check that the risk circuit's math and the Wall Street Clock circuit's sessions match the contracts, `math.ts` and `calendar.ts`, and that nothing in the contracts reads them (D-66). Run an equivalence check with a TapeOut tool such as Forgeout if it fits.
  - Done when: review notes in the PR and the test of BE-83 passes.
- [~] **SC-86 · Router close that does not need a fresh price**
  - Found in SC-72. Applies to Monad too.
  - Problem: `closeLong` and `closeShort` call `RISK.positionLtv` before anything else, and that calls the oracle's `price()`, which reverts when the price is older than the hard age. Then a user cannot close through Levra while the oracle is stale (a holiday next to a weekend on Base, an Anchored outage on Monad), even a full close that Morpho itself would allow. Only a direct close on Morpho works (`docs/public/contracts.md`).
  - Do: let a full close skip the LTV reads when the position ends with no debt, keep every check for a partial close, and add fork tests with a stale oracle for long and short. Check that invariants 2 and 7 in 07 still hold.
  - Done when: a full close through the router succeeds with a stale oracle on both chains, a partial close still reverts, and the router audit scope (SC-53) includes the change.
  - Note: written on 19 November 2026 on branch `sc/SC-86-close-stale-oracle`. A user close reads `positionLtv` in a `try` and counts a failure as unknown; the close event reads the oracle price in a `try` and writes 0 on failure. Keeper reductions are unchanged. `test/StaleClose.t.sol`: full long and short closes pass with a stale oracle, partial ones revert with `OracleStale`, and a close passes with an oracle that reverts outright; `test/Protection.t.sol`: a keeper cannot reduce on a stale oracle. 108 Monad tests, the invariant campaign (all five properties) and Slither pass. Tested on Monad; on Base it follows once markets exist (SC-76). Waiting for review: `contracts/src/` needs a second reader (06).

- [~] **SC-87 · Replace the Monad router**
  - Needs: a second reader for SC-86 and D-79 (06), then the team's go.
  - Why: the live Monad router predates SC-86 (a close needs a fresh price) and D-79 (fixed swap target set). Router code cannot be upgraded, so a new one is deployed next to it.
  - What changes: a new `MarginRouter` and `Lens` over the live `RiskManager` and markets; the deployment file gets the new addresses and `previousRouters` (03 section 6). The old router keeps working, and positions stay in the users' own Morpho accounts, so either router can close them.
  - Migration steps: (1) `make redeploy-router-monad KEEPER=<protector key>`; (2) BE: the indexer reads `router` and every `previousRouters` address, and the keeper protects only users who opted in on the new router (BE side); (3) FE: ask a user with an open position to authorize the new router on the next action (the one signature flow already does this), and ask users who had protection on to turn it on again, since opt-in never moves by itself; (4) verify the source on Sourcify and update 05 and `docs/public/contracts.md`.
  - Done when: the new router is live and verified, the deployment file and the shared bundle are updated, and one real close goes through the new router.
  - Note: script and fork test written on 20 November 2026 (`script/RedeployRouter.s.sol`, `test/RedeployRouter.t.sol`): the new router and lens sit on the live risk manager with KyberSwap as the only target and the same fees, and the file keeps the old router. Not run on mainnet. Checked on 22 November 2026: the second reader is done (BE-94), but the indexer does not read `previousRouters` yet and the app flow for re-authorizing and opting in again is not confirmed, so it is not run. The Monad handover follows the new router, so the new owner key is handed over once.
  - Plan agreed on 22 November 2026, in order: (1) the team's go, with BE confirming the indexer reads `previousRouters` and the keeper knows opt-in does not move, and FE confirming the re-authorize and opt-in flow; (2) Monad handover first, run by the current owner `0x7029...1855` (key entered locally with `read -rs`): timelock, old router, risk manager, liquidator and vault; (3) switch the ACTIVE role lines in `contracts/.env` to the Monad keys; (4) simulate `redeploy-router-monad` with `OWNER` = the Monad timelock and `KEEPER` = the Monad keeper, so the new router is pending to the timelock and needs no separate handover; (5) deploy on an explicit go; (6) verify on Sourcify and MonadVision; (7) PR for `monad.json` (router, lens, `previousRouters`) and the shared test that pins the old router; (8) one Safe batch that schedules `acceptOwnership` on the old router, the new router, the risk manager and the liquidator through the timelock and accepts the vault, then `executeBatch` after 2 days; (9) one real close through the new router. Before that: the `0x7029` key and some MON on it for gas, and a little USDC on Monad for step 9.
  - Note (22 November 2026): steps 1 to 8 done. BE-100 (#122) and the FE flow (#132, in `main` through #134) were in place. (2) HandOver by `0x7029...1855`: timelock `0xf1F6C17660Fa513A42565746a73C654886bd14Dd`, Safe as guardian, pending owners set. (3) ACTIVE lines switched to Monad. (4, 5) router `0xf5585feA7aeDC5e148201052f73139111810aA88` and lens `0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7`, pending to the timelock, fees to the Safe. (6) Sourcify exact match for router, lens and timelock. (7) PR #135. (8) `monad-handover-step1.json` and `step2.json` for the Safe (operation `0x15a2a8a3...fef66`), simulated from the Safe. Left: the Safe runs step 1, then step 2 after 2 days, and (9) one real close through the new router. The old router's fee recipient stays `0x7029...1855`.

