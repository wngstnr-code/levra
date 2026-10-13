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

## Open questions

Every question has an owner and a milestone to answer it by.

| No | Question | Owner | Due by | Via task | Working assumption |
|---|---|---|---|---|---|
| Q-01 | Answered: Levra (D-15). Still open under X-02: domain, social handles, and a conflict check. A quick search found no project named exactly Levra, but found close names in the same field: Levva (DeFi vaults, formerly Marginly), Levr (token launchpad) and Levana (perps) | Nabil | M0 | X-02 | Keep Levra unless the conflict check finds a real problem |
| Q-02 | Which provider gives sign-in by email or passkey (D-16)? Does it create a normal key wallet or a smart account? | Nabil, Wangsit | M0 | FE-02 | Prefer a provider whose embedded wallet is a normal key wallet, so `permit` and the Morpho authorization signature work unchanged. With a smart account, first use must batch `approve` and `setAuthorization` calls instead of using signatures |
| Q-03 | What is the max age of the oracle price, and what happens to the price when the exchange is closed? | Dharu, Wangsit | M1 | BE-03, SC-10 | Numbers are filled in at deployment after a week of data |
| Q-04 | What happens to dividends for stocks held by Morpho? What about the stock borrower (short) when there is a dividend? | Wangsit | M2 | X-12 | Write it in the risk disclosure until it is clear |
| Q-05 | Does Anchored allow its token to be used in a lending venue? Can the Morpho or router address be put on a denylist? | Wangsit | M1 | X-12, SC-05 | Run staging with small funds while waiting for the answer |
| Q-06 | How do the margin and short rules on stocks apply to this product? What kind of legal entity and where? | All three | M5 | X-10, X-20 | There is no strong answer yet |
| Q-07 | What are the transaction fee, the auto-deleverage fee, and the share of interest? | All three | M5 | - | 0.10%, at most 0.30%, 10% of interest |
| Q-08 | Auto-deleverage only by registered keepers, or by anyone? | Wangsit | M3 | SC-30 | Registered keepers first; open it later after it is tested |
| Q-09 | Can a cross-chain deposit open a position directly when the funds arrive? | Dharu, Wangsit | M4 | BE-05, SC-40 | Two steps: funds arrive in the wallet, then one confirmation |
| Q-10 | How does a user from another chain pay their first transaction fee on Monad? | Dharu, Nabil | M4 | BE-05, BE-40 | A second transfer of a little MON through the same service |
| Q-11 | Which version of the Morpho vault is available on Monad and do we use it? | Wangsit | M2 | SC-06, SC-23 | The one with an official factory on Monad |
| Q-12 | Which auditor, when, and paid from what funds? | All three | M5 | X-13 | Get quotes from M3 |
| Q-13 | Which sponsor bounties do we go for? | All three | M0 | X-16 | Aurora Intents and Envio |
| Q-14 | Display language of the app? | Nabil | M5 | FE-55 | English as the main, Indonesian as the second |
| Q-15 | Does the short soft limit need its own number, different from long? | Wangsit, Dharu | M2 | SC-22, BE-34 | Same as long, whichever is more cautious |
| Q-16 | What is the pair token in the aQQQ, aHOOD, aBIL pools? Does it need to go through another token? | Wangsit | M0 | SC-04 | Assume the aggregator finds a route from USDC |
| Q-17 | Can Anvil copy Monad mainnet correctly? | Wangsit | M0 | SC-02 | If not, find another fork tool or test directly on mainnet with small funds |
| Q-18 | Does USDC on Monad support `permit`? | Wangsit | M0 | SC-05 | If not, first use takes two confirmations or the transactions are bundled in the wallet |
| Q-19 | Are the best bid and best ask in the Anchored oracle always filled and reasonable? | Dharu | M1 | BE-03 | If not, use the price only |
| Q-20 | When and how to accept stocks from xStocks? Which oracle is used for them? | All three | After M6 | X-18 | The design already allows a different oracle per market |
| Q-21 | How much of the team treasury goes in as seed funds for markets, and does part of it become liquidity on the exchange? | All three | M2 | X-14 | Start from the supply cap in 04 |

## Differences between this document set and the idea PDF

The PDF was written before the detailed design. In three places, this design differs on purpose:

| Item | In the PDF | In this design | Decision |
|---|---|---|---|
| Price for collateral value | The lower of the oracle and the exchange | Hard limit: oracle only. The exchange only in the soft layer | D-03 |
| Short example of $100 with a $50 loan | Liquidation if the price rises about 54% | About 131%, because the sale proceeds are held as collateral | D-05 |
| Scope | A one-flow demo for the competition | Final version: all flows, all stocks in scope, ready to run as a business | Team request |
