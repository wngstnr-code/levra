# 09. Decisions and open questions

This document records what has been decided and why, and what still has to be answered. The goal is that the same decision is not argued twice, and unanswered questions are not forgotten.

How to use it:

- New decision: add a `D-xx` row through a PR. State the reason and what was rejected.
- Changing an old decision: do not delete it. Mark it "replaced by D-xx" and write the new decision.
- Answered question: move it to the decisions table, or write the answer and mark it done.

## Decisions

| No | Decision | Reason | Rejected |
|---|---|---|---|
| D-01 | Do not build an exchange and do not build a lending venue. Trade on Uniswap v4 and Monday Trade through the KyberSwap aggregator. Lend and borrow on Morpho | Both already run with real funds. Morpho lets anyone create a new market | Sending orders to Unison (a participant in the same competition, with very little money on its exchange); the Anchored partner key (needs permission); a self-built open order system |
| D-02 | Funds stay in the user's own Morpho position. The router works through the `setAuthorization` authorization. The router cannot be changed after deployment; a new version means a new contract and a new authorization | The team never holds funds. Users can exit without us | A smart account per user controlled by the team; a router that can be changed |
| D-03 | The hard limit uses only the Anchored oracle price, on the cautious side (best bid for long, best ask for short). The DEX price is used only in the soft layer | The market on the exchange is too thin and easy to move, so putting it into the hard limit opens a way to trigger liquidation of others | The proposal in the PDF: collateral value from the lower of the oracle and the exchange, for the hard limit |
| D-04 | Hard limit: aBIL 91.5%, aQQQ 77%, aHOOD 62.5% | See 04. For aQQQ, 86% gives a liquidation bonus smaller than the price impact | aQQQ 86% |
| D-05 | On a short, the proceeds from selling the stock are held as collateral | The position is much safer, and this is how shorts usually work | Sending the proceeds to the user's wallet (the assumption in the PDF example, "up 54%") |
| D-06 | USDC is the borrow currency for long and the collateral for short | Available through Aurora Intents to Monad. AUSD is not | AUSD, USDT0 |
| D-07 | Earn does not go through the router. The frontend calls the vault and Morpho directly | The less goes through the router, the smaller the attack surface | An Earn function in the router |
| D-08 | Auto-deleverage is off by default and turned on by the user per market. Closing, reducing, and adding collateral cannot be stopped by anyone | Acting on someone's position needs clear authorization. Users must always be able to exit | Protection on for everyone; a global stop button |
| D-09 | Working environment: a local mainnet fork, then mainnet with very small limits. No mock data in the product; sample data only in test files | The protocols we use exist only on mainnet. The project criteria forbid mock data | Monad testnet; mock services |
| D-10 | Default technology as in 02. The owner of a part may replace it as long as it is recorded and does not change the interface agreements in 03 | So work can start right away | - |
| D-11 | aBIL is long only | Shorting a short-term bond fund has no use | An aBIL short market |
| D-12 | One repo for everything, with one owner per folder | Agreements and addresses are shared; ownership prevents overwriting each other | Three separate repos |
| D-13 | Everything in the repo is in English, including `docs/`. Team chat is in Indonesian | Judges, auditors and outside contributors read the repo | Docs in Indonesian |
| D-14 | The liquidator bot is run by ourselves from the start | A new and small market does not attract other liquidators. Without it nobody closes bad debt | Relying on public liquidators |
| D-15 | The product name is Levra. Packages use the `@levra/*` scope. Contract names stay descriptive (`MarginRouter`, `RiskManager`, `SessionOracle`) | Chosen by the team on 13 October 2026. Short, and it points at leverage. Answers Q-01 | Afterbell, Nightshift, Margo, Gapwise, Sesi, Lonceng, Tandem |
| D-16 | Sign-in without an existing wallet (email or passkey) is in scope from the start, next to plain wallets | Chosen by the team on 13 October 2026. Users arriving from other chains should not need to set up a Monad wallet first | Plain wallets only at launch |
| D-17 | The repo is private under the `wngstnr-code` GitHub account, with Dharu and Nabil as collaborators. It becomes public at submission | Chosen by the team on 13 October 2026 | Public from the start; a new GitHub organization; local only |
| D-18 | The scope in 01 and the split of work in 06 and `docs/tasks/` are approved by all three | Agreed together on 13 October 2026 | - |
| D-19 | The backend builds every router transaction, simulates it and returns it ready to sign. The frontend only checks and displays it | Chosen by the team on 13 October 2026. The logic lives in one place | The frontend encoding router calls from the ABI; both sides encoding |
| D-20 | First use is one confirmation: two gasless signatures (USDC permit and Morpho authorization) applied inside one `multicall` together with the open | Chosen by the team on 13 October 2026. Best experience for new users | Three separate transactions on first use; relying on wallet batching only |
| D-21 | Backend stack: TypeScript, Hono (REST plus SSE), Postgres with Drizzle, Envio for the indexer | Chosen by Dharu on 13 October 2026. Light, and Envio has a bounty. Envio on Monad is still to be proven in BE-06 | NestJS with Prisma; Ponder |
| D-22 | Sign-in provider: Privy, next to plain wallets through wagmi | Chosen by Nabil and Wangsit on 13 October 2026. Privy's docs list Monad as a supported network. Answers Q-02 | Dynamic; deciding later |
| D-23 | Staleness uses two clocks. Market open: the source quote time, `feedUpdateTimestamp`. Market `CLOSED`: the carried price is accepted and freshness is judged on `publishedAt`. The interface gains the source quote time in `snapshot()`, `Lens` and the API | Chosen by the team on 13 October 2026. Matches how the oracle behaves and does not block liquidations over a weekend. Answers Q-22 | `publishedAt` only; Anchored's `latestPriceNoOlderThan` |
| D-24 | The USDC vault is a MetaMorpho v1.1 vault | Chosen by the team on 13 October 2026. Simpler and enough for our case. Answers Q-11 | Vault V2 |
| D-25 | The web app blocks Anchored's full list of prohibited jurisdictions (in 05). Counsel confirms the final list | Chosen by the team on 13 October 2026. Matches the issuer. Answers Q-24 | United States and China only; adding address screening now |
| D-26 | Sponsor bounties to go for: Aurora Intents, Envio and Privy | Chosen by the team on 13 October 2026. They match choices already made. Answers Q-13 | Aurora Intents only; none |
| D-27 | Seed funds for now: staging only, a few hundred dollars of USDC and a little MON. Production seed is decided later | Chosen by the team on 13 October 2026. Answers Q-21 for staging | One tenth of the caps; the full caps |
| D-28 | Fees: 0.10% on open and close, 10% of vault interest, auto-deleverage fee at most 0.30% | Chosen by the team on 13 October 2026. Answers Q-07 | Free at launch; 0.20% and 15% |
| D-29 | Only registered keepers may run auto-deleverage | Chosen by the team on 13 October 2026. Safest at the start. Answers Q-08 | Anyone; a switch to open it later |
| D-30 | Levra is submitted to Monad Metropolis, Track 01, by 14 October 2026 at 10:59 WIB, and the goal is to win. Before the deadline the team builds one real flow on mainnet first (long on aQQQ in one confirmation), then adds what time allows in this order: positions and close, cross-chain deposit, short, sign-in by email. This is the first slice of the final product, built to the same rules, not a throwaway demo | Chosen by the team on 13 October 2026. Answers Q-26 | Not submitting; submitting docs only |
| D-31 | A dedicated role, the oracle age poster, may set `maxOracleAge` per market, only inside bounds that the owner sets. The contract also refuses bounds above the hard source quote age of the market's oracle. This is the single exception to "no single key can loosen anything" | Chosen by Wangsit on 13 October 2026, proposed by Dharu. `maxOracleAge` is a soft check for opening positions, the hard oracle limit is untouched, and the worst a leaked key can do is set the cap the multisig already accepted. Answers Q-27 | Owner only through the timelock; a keeper that may only tighten |
| D-32 | The router gets `repayDebt(marketId, assets)`: the user pays down their own debt with the loan token. For a long this is how margin is added with USDC | Chosen by Wangsit on 13 October 2026. `addCollateral` takes the collateral token, which for a long is stock, so long users had no simple way to lower risk without selling | Leaving it to a direct Morpho call from the frontend |
| D-33 | The backend database lives in its own package, `packages/db` (`@levra/db`): Drizzle schema, migrations and the client, used by api, indexer and keeper. Owner: Dharu. Local Postgres runs from `docker-compose.yml` on port 5442 by default (`LEVRA_PG_PORT` changes it) | Chosen by Dharu on 13 October 2026. One schema for three apps, and it is not a shared interface, so it stays out of `packages/shared` | Schema inside `apps/api`; one schema per app |
| D-34 | The indexer is our own log follower in `apps/indexer`, reading from Envio HyperSync through its JSON API (RPC as fallback) into `packages/db`. Positions are read live from `Lens`; the database keeps the events that history, entry price and PnL need | Chosen by Dharu on 13 October 2026. The Envio CLI (HyperIndex) has no Windows build and needs extra containers, while HyperSync works from any platform and keeps Envio in the stack. Changes D-21 for the indexer. Whether the Envio bounty (D-26) accepts HyperSync without HyperIndex is not verified | Envio HyperIndex in WSL; RPC only |
| D-35 | Hard oracle ages per market: source quote age while open is 1 hour for QQQ and HOOD and 3 hours for BIL; publish age while closed is 4 days for all. Ages to open a position start at 35, 36 and 51 minutes. Proposed from the BE-03 data and implemented in the deployment script. Confirmed by Wangsit on 13 October 2026 and deployed on mainnet with these numbers. The hard ages are now fixed for this deployment | BIL's source quote reached 81.5 minutes after hours, so 1 hour would block its liquidations at times. BIL barely moves, so a longer age costs little. 4 days covers a holiday weekend with a day to spare | One hard age for all markets; 2 hours for BIL, which leaves little room above the 81.5 minutes seen |
| D-36 | The DEX mid price is the average of a 10 USDC buy and a sale of the stock worth 10 USDC at the oracle price, both through KyberSwap. Quotes, `/v1/markets`, the stream and the depth table all use it, and price impact is measured against it. The client lives in `packages/kyber` (owner: Dharu), shared by the API and the keeper | Chosen by Dharu on 13 October 2026. A one-sided probe carries the pool fee and half the spread, which made every sale look about 2% worse than a buy of the same size | A 10 USDC buy only; the pool's own spot price |
| D-38 | The app is English only. All text stays in one message file (`apps/web/lib/i18n/en.ts`), so no sentence is written inside a component and another language can be added later as a file | Chosen by Nabil on 13 October 2026. Answers Q-14 | English and Indonesian with a switch |

## Open questions

Every question has an owner and a milestone to answer it by.

| No | Question | Owner | Due by | Via task | Working assumption |
|---|---|---|---|---|---|
| Q-01 | Answered: Levra (D-15). Still open under X-02: domain, social handles, and a conflict check. A quick search found no project named exactly Levra, but found close names in the same field: Levva (DeFi vaults, formerly Marginly), Levr (token launchpad) and Levana (perps) | Nabil | M0 | X-02 | Keep Levra unless the conflict check finds a real problem |
| Q-02 | Answered: Privy (D-22). Privy's documentation says the embedded wallet is a normal key wallet by default, supports `signTypedData` and can be exported, so the signature path of D-20 should work. Run on 13 October 2026 (FE-02): email and passkey sign-in create a Privy embedded wallet on Monad, its balances read correctly and export shows the recovery phrase, which fits a normal key wallet (HD wallet). A `signTypedData` call is not run yet, so the signature path itself is not verified. It is checked in FE-11 | Nabil, Wangsit | M0 | FE-02 | Proceed on the signature path |
| Q-03 | Answered by observation (BE-03, two weeks including two weekends, `docs/reports/oracle-2026-10-13.md`): writes about every 10 minutes while open; no writes at all while `CLOSED` (about 47.7 hours each weekend), so `feedUpdateTimestamp` and `publishedAt` both stop; source quote age outside `CLOSED` reaches 26.8 minutes for QQQ, 33.6 for HOOD and 81.5 for BIL. Choosing the numbers moves to Q-28 | - | - | - | - |
| Q-04 | What happens to dividends for stocks held by Morpho? What about the stock borrower (short) when there is a dividend? | Wangsit | M2 | X-12 | Write it in the risk disclosure until it is clear |
| Q-05 | Does Anchored allow its token to be used in a lending venue? Can the Morpho or router address be put on a denylist? | Wangsit | M1 | X-12, SC-05 | Run staging with small funds while waiting for the answer |
| Q-06 | How do the margin and short rules on stocks apply to this product? What kind of legal entity and where? | All three | M5 | X-10, X-20 | There is no strong answer yet |
| Q-07 | Answered: see D-28 | - | - | - | - |
| Q-08 | Answered: see D-29 | - | - | - | - |
| Q-09 | Can a cross-chain deposit open a position directly when the funds arrive? | Dharu, Wangsit | M4 | BE-05, SC-40 | Two steps: funds arrive in the wallet, then one confirmation |
| Q-10 | Partly answered: a price-only quote shows 1 USDC on Base can arrive as about 39 MON on Monad in about 39 seconds. Still open: a real transfer | Dharu, Nabil | M4 | BE-05, BE-40 | A second small transfer of MON through the same service |
| Q-11 | Answered: see D-24 | - | - | - | - |
| Q-12 | Which auditor, when, and paid from what funds? | All three | M5 | X-13 | Get quotes from M3 |
| Q-13 | Answered: see D-26 | - | - | - | - |
| Q-14 | Answered: English only (D-38) | - | - | - | - |
| Q-15 | Does the short soft limit need its own number, different from long? | Wangsit, Dharu | M2 | SC-22, BE-34 | Same as long, whichever is more cautious |
| Q-16 | Answered: all three pools pair the stock directly with USDC and routes are a single hop (aggregator routes on 13 October 2026) | Wangsit | M0 | SC-04 | - |
| Q-17 | Answered: yes. Anvil 1.8.3 forks Monad. Forge needs `--network monad`. The full long flow through real Morpho and a real KyberSwap route runs on the fork | - | - | - | - |
| Q-18 | Answered: yes for USDC (`DOMAIN_SEPARATOR` and `nonces` answer). No for aQQQ, aHOOD and aBIL, so lending stock needs a normal `approve` first | Wangsit | M0 | SC-05 | - |
| Q-19 | Answered by observation (BE-03): in 4,603 writes the best bid and best ask were always positive, never crossed, and always around the price. The fallback to the price alone stays as a safety net | - | - | - | - |
| Q-20 | When and how to accept stocks from xStocks? Which oracle is used for them? | All three | After M6 | X-18 | The design already allows a different oracle per market |
| Q-21 | Answered: see D-27 | - | - | - | - |
| Q-22 | Answered: see D-23 | - | - | - | - |
| Q-23 | How is a stock split applied to the token balance and to the oracle price? | Wangsit | M1 | X-12 | Asked of Anchored. Until answered, treat any stock with an announced split as not eligible |
| Q-24 | Answered: see D-25 | - | - | - | - |
| Q-25 | Which domain? `levra.com`, `.io`, `.xyz` and `.app` are in use | Nabil | M0 | X-02 | See "Decisions waiting for the team" |
| Q-26 | Answered: see D-30 | - | - | - | - |
| Q-27 | Answered: see D-31 | - | - | - | - |
| Q-28 | Answered: see D-35 | - | - | - | - |
| Q-29 | Bug bounty: how large are the rewards, who pays them, and which private channel takes the reports? | Wangsit | Before public launch | SC-56 | See "Decisions waiting for the team". Until decided, the draft in `drafts/bug-bounty.md` is not published |

## Decisions waiting for the team

Each has options and a suggestion. Nothing here is decided. When the team picks, the choice moves to the Decisions table.

### Q-25. Domain

| Option | State |
|---|---|
| A. `levra.fi` | No name servers found. Short, fits finance |
| B. `levra.finance` | No name servers found. Clear, longer |
| C. `levra.markets` | No name servers found |
| D. Change the name | `levra.com`, `.io`, `.xyz`, `.app` are in use, and Levva is a DeFi project one letter away |

Availability is only confirmed by a registrar.

### Q-29. Bug bounty rewards and reporting channel

Rewards:

| Option | State |
|---|---|
| A. A share of the funds at risk, with a ceiling: critical 10% up to a fixed cap, lower levels fixed amounts | Common in DeFi. The cap must be money the team really has. Suggested once there is a treasury (X-14) |
| B. Fixed amounts per level, small at first, raised as the supply caps are raised | Simple and honest for a staging product with small caps. Suggested for now |
| C. No paid rewards until after the audit, only public credit | Costs nothing. Gives little reason to report instead of exploit |

Channel:

| Option | State |
|---|---|
| A. GitHub private vulnerability reporting on the repo | Free, works today, off at the moment. One setting to turn on. Suggested |
| B. A security email address on our own domain | Needs the domain first (Q-25) |
| C. A bounty platform | Reaches more researchers. Takes a fee and an application. Fits after the audit |

Nothing here is decided.

## Differences between this document set and the idea PDF

The PDF was written before the detailed design. In three places, this design differs on purpose:

| Item | In the PDF | In this design | Decision |
|---|---|---|---|
| Price for collateral value | The lower of the oracle and the exchange | Hard limit: oracle only. The exchange only in the soft layer | D-03 |
| Short example of $100 with a $50 loan | Liquidation if the price rises about 54% | About 131%, because the sale proceeds are held as collateral | D-05 |
| Scope | A one-flow demo for the competition | Final version: all flows, all stocks in scope, ready to run as a business | Team request |
