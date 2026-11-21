# 07. Testing and security

This product handles other people's money. The `MarginRouter` contract holds authorization from many users at once, so one mistake there can hurt all users. This document sets out what must be tested and which threats must be closed before the product is opened to the public.

## Testing layers

| Layer | Tool | What it tests | Owner |
|---|---|---|---|
| Contract unit tests | Foundry | Every function and every failure path | Wangsit |
| Fork tests | Foundry with a Monad fork | The full flow against the real Morpho, KyberSwap, and Anchored oracle | Wangsit |
| Fork tests on Base and X Layer | Foundry under `--network optimism` (`*BaseForkTest`, `*XLayerForkTest`), apart from the Monad suite | Base: the oracle adapter against the real feeds and registry. X Layer: the wrapped xStocks through Morpho | Wangsit |
| Fork end-to-end on X Layer | `make xlayer-fork-e2e`: the real deployment script on a local X Layer fork, then a long and a short through OKX DEX and Uniswap with calldata from the live OKX DEX API | Proves D-88 (a spender separate from the target) with the real aggregator, and that the router ends empty | Wangsit |
| Live end-to-end on Base | `make base-live-e2e`: our contracts deployed and a long and a short opened and closed inside one `eth_simulateV1` run on the live node, through every swap target of D-80 | The only way to run the router against Coinbase stock tokens before deploying. Checks that every position ends at zero and the router holds nothing | Wangsit |
| Live checks on Base | Vitest against a live Base node: reads and `eth_simulateV1` (`*.live.test.ts`, run with `BASE_RPC_URL`) | Coinbase stock tokens are precompiles that a local fork cannot run, so token moves through Morpho and the swap routers are simulated on the real node. Router code on Base still needs its own plan (SC-75, SC-76) | Wangsit |
| Fuzz and invariant tests | Foundry | The invariants, with random inputs | Wangsit |
| Static analysis | Slither | Common error patterns | Wangsit |
| Formula tests | Vitest | `math.ts` gives the same result as `Lens` | Dharu |
| Backend tests | Vitest | Quote engine, indexer, keepers | Dharu |
| End-to-end UI tests | Playwright with a local fork | The seven user flows from start to finish | Nabil |
| Integration checkpoint | Manual, on mainnet | Real flows with real money | All three |

Mock data exists only in test files. Fork tests and integration checkpoints use the real market state.

## Invariants

These become the invariant tests (SC-50). If any one of them can be broken, it is a bug that blocks the launch.

### MarginRouter

1. After any transaction, the router holds no tokens.
2. User functions only change the position of `msg.sender`. There is no way to make the router borrow or take collateral on behalf of someone else, except through `deleverage` with its conditions.
3. `deleverage` fails if the user has not turned on protection, if the position is still below the soft limit, or if the swap price deviates beyond the limit.
4. After `deleverage`, the user's LTV is lower than before, and the net value of the position does not fall by more than the highest keeper fee plus the highest price deviation.
5. After a successful `openLong` or `openShort`, the LTV does not exceed the soft limit at that moment and does not exceed the user's `maxLtv`.
6. The close, reduce, and add collateral functions keep working while opening is paused.
7. A swap target outside the allowlist is always rejected. Morpho, the tokens, and the router itself can never be on the allowlist.
8. Fees never exceed the highest limit that is hard-coded.
9. The flash loan callback is only accepted from Morpho, and only when the router itself started it.

### SessionOracle

1. For the same p8 price, `price()` on the long market times `price()` on the short market, after adjusting for scale, equals one (within rounding), when the best bid and best ask equal the price.
2. `price()` never returns zero.
3. `price()` fails if the price from Anchored is zero, negative, or older than the hard max age.
4. The price used by the long market is never higher than the Anchored price. The stock price used by the short market is never lower.

### RiskManager

1. `currentSoftLtv` is always lower than the hard limit of its market.
2. The guardian role can only tighten. No sequence of guardian calls loosens a limit.
3. The oracle age poster can change one value only, `maxOracleAge`, and only inside the bounds the owner set. Those bounds never exceed the hard source quote age of the market's oracle (D-31).
3. `setNextCloseAt` rejects a time in the past and a time more than 8 days away.

## Threat list

Every row must have a test that shows its mitigation works.

### Threat pass (SC-52, 20 November 2026)

Each threat above, marked against the code as it stands after D-89 to D-93. "Closed" means a test in `contracts/test/` shows the mitigation works. "Not closable by code" means the risk sits with an issuer, an operator or off chain, and names where it is handled instead. Done by Wangsit after the human second read (Dharu, Nabil, no findings).

| No | Status | Evidence |
|---|---|---|
| T-01 | Closed | `SwapTargets.t.sol` (all 10 tests, including `testFuzz_onlyListedAddressesAreTargets`, `test_refusesMorphoAsASpenderAndMismatchedLists`, `test_failsWhenOnlyTheTargetIsApproved`); `Long.t.sol` `test_revertsOnUnknownSwapTarget`, `test_revertsWhenSwapReturnsLessThanMinimum`; invariants `invariant_routerHoldsNoTokens`, `invariant_nobodyCanTouchAPositionOfSomeoneElse` |
| T-02 | Closed | `Long.t.sol` `test_flashCallbackCannotBeCalledDirectly`; `Security.t.sol` `test_swapTargetCannotFakeTheFlashCallback`; `Liquidator.t.sol` `test_callbackCannotBeCalledDirectly` |
| T-03 | Closed | `Security.t.sol` `test_swapTargetCannotReenterAnEntryPoint`, `test_swapTargetCannotReenterThroughMulticall` |
| T-04 | Closed | `Protection.t.sol` (14 tests: keeper only, user consent, above soft limit only, deviation, no full close, no zero debt end, size bound, closed session, stale price, issuer pause); `Short.t.sol` `test_keeperReducesAProtectedShortInsideTheBounds`, `test_keeperCannotTakeOutMoreUsdcThanTheShortRepays`; `invariant_feesStayWithinTheirCaps` |
| T-05 | Closed | The hard limit is Morpho's own `price()`; DEX fills only reach the soft layer. `ChainlinkOracle.t.sol` `test_matchesMorphoOwnOracleOnAWeekday`; `OracleFuzz.t.sol` (6 fuzz tests); `Long.t.sol` `test_revertsWhenFillIsFarFromOracle` |
| T-06 | Closed for the code part | `Risk.t.sol` stale tests (`test_openMarketPriceGoesStaleOnTheSourceQuoteTime`, `test_closedMarketGoesStaleWhenTheHeartbeatStops`, `test_openingNeedsAFresherPriceThanTheHardLimit`); `OracleFuzz.t.sol` `testFuzz_stalenessFollowsTheRightClock`; `Long.t.sol` `test_revertsAbovePositionCap`; `Vault.t.sol` `test_capLimitsWhatOneMarketCanReceive`. The oracle monitor is BE-50 |
| T-07 | Not closable by code | Anchored controls its oracle. Small supply caps (04), monitoring (BE-50), runbook |
| T-08 | Not closable by code | Anchored controls the token and its denylist. X-12, small caps, risk disclosure |
| T-09 | Closed for the code part | `Long.t.sol` `test_revertsWhenSwapReturnsLessThanMinimum`, `test_revertsWhenFillIsFarFromOracle`; `Protection.t.sol` `test_keeperCannotSellFarBelowTheOraclePrice`. Showing the price before confirmation is FE |
| T-10 | Closed | `Security.t.sol` `test_firstUseSignaturesCannotBeUsedTwice`, `test_revokedAuthorizationCannotBeRestoredWithTheOldSignature`, `test_aSignatureForAnotherSpenderGivesTheRouterNothing`, `test_expiredSignaturesAreRejected`, `test_someoneSubmittingTheSignaturesFirstDoesNotBlockTheUser`; `Risk.t.sol` `test_cannotAuthorizeOnBehalfOfSomeoneElse` |
| T-11 | Closed | `Governance.t.sol` (7 tests: timelock for loosening, only the multisig uses the timelock, the deployer can change nothing after the handover); `Risk.t.sol` `test_guardianCanOnlyTighten`, `test_guardianCanPauseButNotResume`, `test_strangersCannotChangeAnything`; `Long.t.sol` `test_openingCanBePausedButClosingCannot` |
| T-12 | Closed | `Long.t.sol` `test_closeLongInFull` (full close by shares leaves 0 debt), `test_repayDebtNeverTakesMoreThanTheDebt`; `Short.t.sol` `test_closeShortInFull`; the invariant campaign closes and reduces with random fractions |
| T-13 | Closed for the code part | `Liquidator.t.sol` `test_liquidatesALongAfterThePriceFalls`, `test_liquidatesAShortAfterThePriceRises`. Running the bot is BE-32 |
| T-14 | Not closable by code | Position and supply caps follow market depth (04). `Liquidator.t.sol` `test_refusesALossUnlessToldToCoverIt` shows a bad fill reverts unless a budget covers it |
| T-15 | Not closable by code | Keeper heartbeat and alerts (BE-50, `/v1/status`) |
| T-16 | Not closable by code | One domain (`levra.finance`, D-96), addresses published in `docs/public/contracts.md` |
| T-17 | Not closable by code, partly mitigated | Swap output is measured from balance differences (`_swapOut`). `test/FeeOnTransfer.t.sol` (21 November 2026) uses a stock that burns 1% of each transfer: a route that promises more than arrives reverts `InsufficientSwapOutput` with the amount really received, and an open credits only what arrived and leaves the router empty. The same test shows Morpho Blue booking more collateral than it receives, so an issuer upgrade that adds a fee breaks the market itself. Watch token upgrades (BE-75, T-21, T-23) |
| T-18 | Not closable by code | Q-23; a stock with an announced split is not eligible |
| T-19 | Not closable by code | The app asks for exact approvals (FE) |
| T-20 | Not closable by code | Anchored session flip before the weekend. Oracle monitor (BE-50). A full close still works without a price: `StaleClose.t.sol` |
| T-21 | Not closable by code | Coinbase policy admin. Small caps (SC-74), alerts (BE-75), `b20-policy.live.test.ts` |
| T-22 | Closed for the code part | `StaleClose.t.sol` (5 tests: full close without a price, partial close still needs one); `ChainlinkOracle.t.sol` `test_mondayHolidayStopsThePriceUntilTheFeedWrites`; `Protection.t.sol` `test_keeperCannotReduceOnAStaleOracle`. The holiday stop of partial reduces is a known exception to rule 8 (PROGRESS) |
| T-23 | Not closable by code | xStocks issuer Safes. `XStocks.t.sol` `test_aSanctionedRouterCannotReceiveTheWrappedStock` shows the effect on a fork. Small caps (SC-82), alerts (BE side) |
| T-24 | Closed | `Liquidator.t.sol` `test_refusesALossUnlessToldToCoverIt` (budget spent, owner only), `test_refusesAMarketWithTheSameLoanAndCollateralToken`, `test_onlyKeepersAndOnlyTheAllowedSwapTarget`, `test_ownerControlsKeepersTreasuryAndFloat` |

| No | Threat | Impact | Mitigation |
|---|---|---|---|
| T-01 | Swap calldata crafted by an attacker makes the router call Morpho or a token | Borrow or take collateral on behalf of all users who gave authorization | Swap target allowlist: one to three targets fixed in the constructor, never changeable, never Morpho or the zero address (D-79), each with a fixed spender that is never Morpho (D-88, `test/SwapTargets.t.sol`); the spender is approved for exactly the swap amount and reset to zero after the call, and the output is measured from balances, so a spender that pulled the tokens elsewhere only fails the `minOut` check; token approval only for the amount used and set back to zero; invariants 2 and 7 |
| T-02 | Someone calls the flash loan callback function directly | Runs a step on behalf of someone else | Check that the caller is Morpho and that the router is in the middle of its own call |
| T-03 | Reentrancy through a token or swap target | Broken state in the middle of a transaction | Reentrancy guard on all external functions |
| T-04 | A malicious keeper deleverages a user's position at a bad price | The user loses money | `deleverage` conditions; limit on deviation from the oracle price; keeper fee is capped; at first only registered keepers (Q-08). Since D-90 to D-92 a reduction must also leave debt, end no more than 5 points below the soft limit, and take out collateral worth no more than the debt it repays plus the bounded costs (`DeleverageTooLarge`) (`Protection.t.sol`). D-93: no keeper reduction while the session is `Closed` |
| T-05 | The DEX price is pushed down to trigger a liquidation | Users are liquidated unfairly | The hard limit uses only the Anchored oracle (D-03) |
| T-06 | A stale oracle price is exploited | Loss for lenders | Room in the hard limit; max age; supply cap per market; oracle monitor |
| T-07 | Anchored changes or shuts down the oracle | Market stuck or wrong price | Cannot be closed with code. Verified in SC-05: the oracle is an upgradeable proxy and prices are written by an operator role. Monitoring, small supply cap, incident runbook |
| T-08 | Anchored blocks the Morpho or router address, or changes the token | Collateral is locked | Cannot be closed with code. Verified in SC-05: one call adds an address to the denylist of the compliance contract, and both the tokens (one beacon for all) and the compliance contract are upgradeable. Morpho is not on the denylist today. Ask Anchored (X-12); small supply cap; explain in the risk disclosure |
| T-09 | Backend is compromised and gives bad routes | Users get a bad price | Minimum output signed by the user; the contract rejects deviation above the limit; frontend shows the price before confirmation |
| T-10 | A permit signature is reused or used by someone else | Authorization given against the user's will | Nonce and deadline from Morpho and the token; frontend shows what is being signed |
| T-11 | Multisig key or guardian key leaks | Limits are loosened, opening is paused | Timelock for loosening; guardian can only tighten; funds stay untouched |
| T-12 | Rounding and very small remainders | Close transaction fails, or a remainder is left behind | Fuzz tests; full close uses debt shares (`shares`), not an amount |
| T-13 | Nobody closes an unhealthy position | Loss for lenders | Own liquidator bot (BE-32); position cap |
| T-14 | Price impact during liquidation is larger than the bonus | Liquidator loses money, the position is left open | Position cap and supply cap follow market depth (04) |
| T-15 | The keeper is down before market close | Protection does not run | Heartbeat monitor; alert to the team; users were told 24 hours before |
| T-16 | A fake site imitates the app | Users give authorization to a fake contract | Contract addresses are announced; one domain name; teach users to check the address |
| T-17 | A token has a fee on transfer or unusual behavior | Wrong calculation | Checked in SC-05: no fee on transfer in the current stock token or USDC. An upgrade could add one, so the router still calculates from the balance difference, not from the requested amount |
| T-18 | A stock split or dividend changes the price per token without changing balances | Positions are liquidated for no market reason | Not known how Anchored applies these (Q-23). Until answered, a stock with an announced split is not eligible |
| T-20 | The last oracle write before a weekend leaves the session as an open one, not `CLOSED` | `price()` reverts after the hard source quote age and liquidations are blocked until the market reopens | Cannot be closed with code without accepting stale prices. Seen flipping for 15 minutes every Friday, always ending on `CLOSED` so far. The oracle monitor alerts on it (BE-50) |
| T-19 | The stock tokens have no `permit` | A user approves an unlimited amount to save a step | The app asks for exact approvals. Applies to lending stock and to adding stock collateral |
| T-21 | One key (`policyAdmin(5)`, an address with no code) adds Morpho, our router, our liquidator or a user to the blocklist of all 8 Coinbase stocks on Base, or the issuer pauses transfers | Closing, reducing and liquidating a Base position fail because the stock cannot move. Bad debt can build up while the price moves | Cannot be closed with code. Small position caps on Base (SC-74), the keeper alerts on any `PolicyUpdated`, blocklist change or pause (BE-75), the risk disclosure says it, and `b20-policy.live.test.ts` is run before listing and after SC-76 |
| T-22 | The oracle passes its hard age (a holiday next to a weekend on Base, an Anchored outage on Monad) | `price()` reverts, and our router close reads it first, so users cannot close through Levra; only a direct close on Morpho works | SC-86: a user's full close no longer needs a price (`test/StaleClose.t.sol`, long and short). A partial close and a keeper reduction still revert with `OracleStale`, so a stale price never moves a position that keeps debt. `docs/public/contracts.md` still explains the direct close on Morpho. D-92: on Base and X Layer a Monday holiday stops the price from Monday 01:00 UTC until the feed writes (fail closed by choice; a full close still works) |
| T-23 | On X Layer the issuer adds Morpho, our router, our liquidator or a user to the xStocks sanctions list, pauses the tokens, or upgrades them (owner and pauser are Safes with threshold 2) | Closing, reducing and liquidating an X Layer position fail because the stock cannot move. Shown on a fork: a listed contract cannot receive the wrapped token | Cannot be closed with code. Small position caps on X Layer (SC-82), the keeper alerts on sanctions list changes, pauses and upgrades (BE side), and the risk disclosure says it |
| T-24 | A leaked liquidator keeper key sends swap output to itself, or liquidates in a market it made, and lets the float repay the debt | The team float is drained | Since D-91 and D-92 the float can lose at most `lossBudgetOf(loanToken)` in total, zero unless the owner sets it; each loss spends the budget, the owner adds to it or clears it, and a market whose loan and collateral token are the same is refused (D-93) (`Liquidator.t.sol`) |

## Backend and keeper security

| Item | Rule |
|---|---|
| Keeper keys | One key per role. Just enough MON balance. Never in the repo, never in notes |
| Keeper key rights on the network | The calendar poster can only call `setNextCloseAt`. The protector can only call `deleverage`. The liquidator can only call `Liquidator` |
| API input | All checked with the same zod schemas that the frontend uses |
| Rate limit | Per IP address and per wallet address |
| Personal data | Store only what is needed: wallet address, alert choices, email address if the user provides one |
| External service down | The quote fails with a clear message; never gives an approximate number |
| Simulation | Every quote is simulated against the network before it is sent to the frontend |

## Frontend security

| Item | Rule |
|---|---|
| What is signed | Always shown in plain sentences before the wallet opens |
| Token approval | Only the amount needed, not unlimited, unless the user chooses it |
| Morpho authorization | Its meaning is explained, and there is a button to revoke it in Settings |
| Transaction data from the backend | Checked: the target must be the router address from `packages/shared`, and the function and arguments are matched with what is shown |
| Dependencies | Versions are locked; updates go through a PR |

## Audit and after

| Step | When | Task |
|---|---|---|
| Internal review with a checklist | Before the audit | SC-52 |
| Contract code freeze | Before the audit | SC-53 |
| External audit | Milestone M5 | SC-53, X-13 |
| Fix findings and re-audit the changed parts | After the audit | SC-54 |
| Bug bounty program | From launch | SC-56 |
| Supply caps and limits raised step by step | After launch | 08-startup-readiness.md |

Until the audit is done, the contracts are used only in staging with team money and very small limits.

## If something goes wrong

The incident runbook is written in task BE-53 and kept in `docs/`. At minimum it must have steps for:

1. The oracle price stops updating.
2. Anchored pauses a token or blocks an address.
3. A bug is found in the router. First step: pause opening, then ask users to revoke the Morpho authorization. Users can still close positions directly on Morpho.
4. There is bad debt in a market.
5. The keeper is down.
6. The backend or the site is down.
