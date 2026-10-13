# 07. Testing and security

This product handles other people's money. The `MarginRouter` contract holds authorization from many users at once, so one mistake there can hurt all users. This document sets out what must be tested and which threats must be closed before the product is opened to the public.

## Testing layers

| Layer | Tool | What it tests | Owner |
|---|---|---|---|
| Contract unit tests | Foundry | Every function and every failure path | Wangsit |
| Fork tests | Foundry with a Monad fork | The full flow against the real Morpho, KyberSwap, and Anchored oracle | Wangsit |
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
3. `setNextCloseAt` rejects a time in the past and a time more than 8 days away.

## Threat list

Every row must have a test that shows its mitigation works.

| No | Threat | Impact | Mitigation |
|---|---|---|---|
| T-01 | Swap calldata crafted by an attacker makes the router call Morpho or a token | Borrow or take collateral on behalf of all users who gave authorization | Swap target allowlist; token approval only for the amount used and set back to zero; invariants 2 and 7 |
| T-02 | Someone calls the flash loan callback function directly | Runs a step on behalf of someone else | Check that the caller is Morpho and that the router is in the middle of its own call |
| T-03 | Reentrancy through a token or swap target | Broken state in the middle of a transaction | Reentrancy guard on all external functions |
| T-04 | A malicious keeper deleverages a user's position at a bad price | The user loses money | `deleverage` conditions; limit on deviation from the oracle price; keeper fee is capped; at first only registered keepers (Q-08) |
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
| T-19 | The stock tokens have no `permit` | A user approves an unlimited amount to save a step | The app asks for exact approvals. Applies to lending stock and to adding stock collateral |

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
