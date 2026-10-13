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

## Open questions

Every question has an owner and a milestone to answer it by.

| No | Question | Owner | Due by | Via task | Working assumption |
|---|---|---|---|---|---|
| Q-01 | Answered: Levra (D-15). Still open under X-02: domain, social handles, and a conflict check. A quick search found no project named exactly Levra, but found close names in the same field: Levva (DeFi vaults, formerly Marginly), Levr (token launchpad) and Levana (perps) | Nabil | M0 | X-02 | Keep Levra unless the conflict check finds a real problem |
| Q-02 | Answered: Privy (D-22). Privy's documentation says the embedded wallet is a normal key wallet by default, supports `signTypedData` and can be exported, so the signature path of D-20 should work. Still to confirm by running it in FE-02 | Nabil, Wangsit | M0 | FE-02 | Proceed on the signature path |
| Q-03 | Partly answered from Anchored's documentation: 10 minute heartbeat, source quote about 15 minutes delayed, suggested max age at least 1,500 seconds, and the price is carried forward while `CLOSED`. Still open: confirm by a week of observation, then choose the numbers | Dharu, Wangsit | M1 | BE-03, SC-10 | See Q-22 for which clock to use |
| Q-04 | What happens to dividends for stocks held by Morpho? What about the stock borrower (short) when there is a dividend? | Wangsit | M2 | X-12 | Write it in the risk disclosure until it is clear |
| Q-05 | Does Anchored allow its token to be used in a lending venue? Can the Morpho or router address be put on a denylist? | Wangsit | M1 | X-12, SC-05 | Run staging with small funds while waiting for the answer |
| Q-06 | How do the margin and short rules on stocks apply to this product? What kind of legal entity and where? | All three | M5 | X-10, X-20 | There is no strong answer yet |
| Q-07 | What are the transaction fee, the auto-deleverage fee, and the share of interest? | All three | M5 | - | 0.10%, at most 0.30%, 10% of interest |
| Q-08 | Auto-deleverage only by registered keepers, or by anyone? | Wangsit | M3 | SC-30 | Registered keepers first; open it later after it is tested |
| Q-09 | Can a cross-chain deposit open a position directly when the funds arrive? | Dharu, Wangsit | M4 | BE-05, SC-40 | Two steps: funds arrive in the wallet, then one confirmation |
| Q-10 | Partly answered: a price-only quote shows 1 USDC on Base can arrive as about 39 MON on Monad in about 39 seconds. Still open: a real transfer | Dharu, Nabil | M4 | BE-05, BE-40 | A second small transfer of MON through the same service |
| Q-11 | Both exist on Monad: the MetaMorpho v1.1 factory and the Vault V2 factory (addresses in 05). Which one do we use? See "Decisions waiting for the team" | Wangsit | M2 | SC-23 | MetaMorpho v1.1 unless a reason for V2 appears |
| Q-12 | Which auditor, when, and paid from what funds? | All three | M5 | X-13 | Get quotes from M3 |
| Q-13 | Which sponsor bounties do we go for? | All three | M0 | X-16 | Aurora Intents, Envio and Privy |
| Q-14 | Display language of the app? | Nabil | M5 | FE-55 | English as the main, Indonesian as the second |
| Q-15 | Does the short soft limit need its own number, different from long? | Wangsit, Dharu | M2 | SC-22, BE-34 | Same as long, whichever is more cautious |
| Q-16 | Answered: all three pools pair the stock directly with USDC and routes are a single hop (aggregator routes on 13 October 2026) | Wangsit | M0 | SC-04 | - |
| Q-17 | Mostly answered: Anvil 1.8.3 forks Monad, reads work and an impersonated `approve` works. A full swap and Morpho flow on the fork is not tested yet | Wangsit | M0 | SC-02 | Use Anvil |
| Q-18 | Answered: yes for USDC (`DOMAIN_SEPARATOR` and `nonces` answer). No for aQQQ, aHOOD and aBIL, so lending stock needs a normal `approve` first | Wangsit | M0 | SC-05 | - |
| Q-19 | Partly answered: Anchored's documentation says the oracle rejects any write where a price is not positive or bid exceeds ask. One live read agreed. Still to confirm over a week | Dharu | M1 | BE-03 | Keep the fallback to the price alone |
| Q-20 | When and how to accept stocks from xStocks? Which oracle is used for them? | All three | After M6 | X-18 | The design already allows a different oracle per market |
| Q-21 | How much of the team treasury goes in as seed funds for markets, and does part of it become liquidity on the exchange? | All three | M2 | X-14 | Start from the supply cap in 04 |
| Q-22 | Which clock decides that the oracle price is stale: `feedUpdateTimestamp`, `publishedAt`, or both depending on the session? The frozen interface exposes only `publishedAt` | Wangsit, Dharu | M1 | SC-10 | See "Decisions waiting for the team" |
| Q-23 | How is a stock split applied to the token balance and to the oracle price? | Wangsit | M1 | X-12 | Asked of Anchored. Until answered, treat any stock with an announced split as not eligible |
| Q-24 | Which places does the web app block? | All three | M5 | BE-52, X-10 | See "Decisions waiting for the team" |
| Q-25 | Which domain? `levra.com`, `.io`, `.xyz` and `.app` are in use | Nabil | M0 | X-02 | See "Decisions waiting for the team" |
| Q-26 | Do we submit to Monad Metropolis on 14 October 2026, and with what? | All three | Now | X-16 | See "Decisions waiting for the team" |

## Decisions waiting for the team

Each has options and a suggestion. Nothing here is decided. When the team picks, the choice moves to the Decisions table.

### Q-22. Which clock decides staleness

| Option | What it means | Trade-off |
|---|---|---|
| A. Two clocks by session (suggested) | Market open: stale when the source quote (`feedUpdateTimestamp`) is too old. Market `CLOSED`: accept the carried price and check the heartbeat (`publishedAt`) | Matches how the oracle behaves. Needs `feedUpdateTimestamp` added to `snapshot()`, `Lens` and the API, which is an interface change |
| B. `publishedAt` only | Keep the frozen interface as it is | Simple, but a fresh write of an old quote looks fresh. Hides the 15 minute delay |
| C. Use Anchored's `latestPriceNoOlderThan` | Let their contract decide | Reverts all weekend, because the quote time stops while closed. Would block liquidations |

### Q-11. Which Morpho vault for lending USDC

| Option | What it means | Trade-off |
|---|---|---|
| A. MetaMorpho v1.1 (suggested) | The established vault type. Allocates only to Morpho markets, with a supply cap per market | Simpler, widely integrated. Enough for our case |
| B. Vault V2 | The newer type with adapters | More flexible, more moving parts, more to audit and explain |

Not verified: which type the Morpho app on Monad lists and promotes. Check before deciding.

### Q-24. Which places the web app blocks

| Option | What it means | Trade-off |
|---|---|---|
| A. Anchored's full prohibited list (suggested) | The list in 05, including the United States, China, Canada and sanctioned places | Matches the issuer. Lowest risk of being cut off by them |
| B. United States and China only | What earlier docs assumed | Easier, but allows people the issuer forbids |
| C. Option A plus sanctions screening of wallet addresses | Adds a screening provider | Strongest, costs money and adds a provider |

Counsel (X-10) should confirm the final list.

### Q-25. Domain

| Option | State |
|---|---|
| A. `levra.fi` | No name servers found. Short, fits finance |
| B. `levra.finance` | No name servers found. Clear, longer |
| C. `levra.markets` | No name servers found |
| D. Change the name | `levra.com`, `.io`, `.xyz`, `.app` are in use, and Levva is a DeFi project one letter away |

Availability is only confirmed by a registrar.

### Q-26. Monad Metropolis submission

The deadline is 14 October 2026 at 10:59 WIB. The rules ask for a demo video with real Monad transactions. Today the repo has design docs, frozen interfaces and API schemas. No contract is deployed and no transaction exists.

| Option | What it means | Trade-off |
|---|---|---|
| A. Do not submit, keep building the final product | Follows the team's choice to build the final version and ignore the deadline | No prize, no judge feedback |
| B. Submit what exists | Docs, interfaces and schemas, with a video that explains the design | Does not meet the real-transaction requirement. Likely scored low |
| C. Build one real flow before the deadline | A long on aQQQ on mainnet with a small amount | Needs funds today and nearly all remaining hours. Goes against "not an MVP" |

No suggestion here. It depends on what the team wants from the hackathon.

### Q-13. Sponsor bounties

| Option | Bounties |
|---|---|
| A. Aurora Intents, Envio and Privy (suggested) | They match choices already made (D-21, D-22, cross-chain deposits) |
| B. Aurora Intents only | The largest one that fits the core flow |
| C. None | Skip bounty work |

Only matters if the answer to Q-26 is not A.

### Q-21. Seed funds

| Option | Amount | Use |
|---|---|---|
| A. Staging only for now (suggested) | A few hundred dollars of USDC plus a little MON | Enough for the spikes and the first real flows. Decide production seed later |
| B. One tenth of the proposed caps | About $3,500 | Markets feel real from the start |
| C. The full proposed caps | About $35,000 | Only after the audit |

### Q-07. Fees

| Option | Transaction fee | Share of vault interest |
|---|---|---|
| A. As proposed (suggested) | 0.10% on open and close | 10% |
| B. Free at launch | 0% | 0%, switched on later |
| C. Higher | 0.20% | 15% |

With position caps of $500 to $1,000, any of these earns very little. The fee mostly signals the business model.

### Q-08. Who may run auto-deleverage

| Option | What it means | Trade-off |
|---|---|---|
| A. Registered keepers only (suggested) | Only our keeper address can call it | Safest at the start. Depends on our keeper being up |
| B. Anyone | Open to all, bounded by the price deviation check | No single point of failure, more exposure to bad execution |
| C. Registered first, opened later | Start with A, move to B after it is proven | Needs a switch in the contract |

## Differences between this document set and the idea PDF

The PDF was written before the detailed design. In three places, this design differs on purpose:

| Item | In the PDF | In this design | Decision |
|---|---|---|---|
| Price for collateral value | The lower of the oracle and the exchange | Hard limit: oracle only. The exchange only in the soft layer | D-03 |
| Short example of $100 with a $50 loan | Liquidation if the price rises about 54% | About 131%, because the sale proceeds are held as collateral | D-05 |
| Scope | A one-flow demo for the competition | Final version: all flows, all stocks in scope, ready to run as a business | Team request |
