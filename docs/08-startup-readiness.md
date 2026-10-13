# 08. Startup readiness

This document covers what sits outside the code and separates a real product from a demo: launch gates, how to run it day to day, legal matters, how to make money, how to get users, and the competition submission package.

## Public launch gates

The product opens to the public only when all of these rows are met. None can be skipped.

### Product

- [ ] All seven user flows work on mainnet for all stocks in scope.
- [ ] All integration checkpoints I-1 to I-6 pass (see tasks/00-shared.md).
- [ ] People outside the team finish flows 1 to 5 without help.
- [ ] There is no mock data, no dead buttons, and no half-finished pages.
- [ ] The app is comfortable to use on a phone.

### Security

- [ ] All invariants in 07 have invariant tests that pass.
- [ ] All threats in 07 have a test for their mitigation.
- [ ] The external audit is done, high and medium findings are fixed, and the report is published.
- [ ] Contract ownership is held by a multisig with a timelock. There is no single key.
- [ ] The bug bounty program is announced.

### Operations

- [ ] Monitoring and alerts for the team are on (see the Operations section).
- [ ] The protector keeper is proven to work through one real weekend close.
- [ ] The liquidator bot is proven to close a test unhealthy position.
- [ ] The incident runbook is written and has been practiced once.
- [ ] The status page is publicly visible.
- [ ] The database backup is tested and can be restored.

### Legal and compliance

- [ ] Legal counsel has been consulted (X-10).
- [ ] Terms of use, privacy policy, and risk disclosure are published.
- [ ] Geo-blocking is on.
- [ ] There is a written answer from Anchored about using the token in a lending venue and about dividends (X-12).

### Markets

- [ ] Each market has seed funds so there is something to borrow.
- [ ] Position cap and supply cap meet the rules in 04, based on the latest market depth measurement.

## Operations

### What we monitor

| What we monitor | Alert the team when | Task |
|---|---|---|
| Oracle price age per stock | Older than the limit, while the exchange is open | BE-50 |
| Market session | Changes outside the expected schedule | BE-50 |
| Gap between DEX price and oracle | Passes `maxDeviationBps` | BE-50 |
| Heartbeat of each keeper | No heartbeat for more than a few minutes | BE-50 |
| Risk values posted by keepers (`maxOracleAge`, `nextCloseAt`) | Every change, with the old and new value | BE-50 |
| MON balance of keepers | Below the safe limit | BE-50 |
| Unhealthy positions not yet closed | Present for more than a few minutes | BE-50 |
| Bad debt | More than zero | BE-50 |
| Share of funds borrowed per market | Close to 100%, lenders have trouble withdrawing | BE-50 |
| Market depth on the exchange | Falls enough to break the position cap rule | BE-04, BE-50 |
| Last block of the indexer | Falling behind | BE-50 |
| API errors and response time | Pass the threshold | BE-50 |
| Errors in the web app | Spike | FE-54 |

### Who is on watch

The three of us take turns. In the first weeks after launch, one person is reachable at all times, especially on Friday before market close and on Sunday night or Monday when the exchange opens again.

### Raising limits

The position cap and supply cap start small and are raised step by step:

1. The backend measures market depth every day.
2. A proposal to raise is made when the rules in 04 are met for two weeks in a row.
3. The raise goes through the multisig with a timelock, and is announced.

## Legal and compliance

This is the weakest part of the plan and cannot be solved with code. What is written here is not legal advice.

| Item | Situation | What to do |
|---|---|---|
| Lending money to buy stocks, and shorting | Tightly regulated in almost every country. There is no strong answer yet | Consult legal counsel before opening to the public (X-10) |
| Issuer restrictions | Anchored tokens are for professional and qualified investors outside its prohibited jurisdictions, a list longer than the United States and China (see 05) | Geo-blocking, with the list still to be decided (Q-24); users declare they are eligible |
| Anchored terms of use | Not yet read for the case of a lending venue | Ask directly (X-12) |
| Dividends | Paid to the wallet of the holder. Collateral stocks are held by Morpho, so their fate is unclear | Ask directly (X-12). Until it is clear, write it in the risk disclosure |
| Legal entity | None yet | Decide the form and place together with counsel (X-20) |
| Personal data | The app stores little | Privacy policy; store as little as possible |

The stance we hold: the contracts are open and do not hold funds. Our web app is the single door, and that door is what we restrict. This is not a complete answer, and legal counsel must judge it.

### Contents of the risk disclosure

It must cover, in plain language: liquidation and its penalty; price gaps when the exchange opens; an oracle price that is delayed and controlled by one party; a DEX price that can deviate from the real stock price; thin markets; the issuer's control over the token; unclear dividends; the risk that lenders bear bad debt; contracts that can have bugs even after an audit.

## How to make money

| Source | How it works | Initial proposal | Notes |
|---|---|---|---|
| Transaction fee | Taken from the position value when opening and when closing | 0.10% | The highest limit of 0.50% is hard-coded in the contract |
| Auto-deleverage fee | Taken from the value that is reduced | At most 0.30% | To cover the cost of the keeper |
| Share of interest | The USDC Earn vault takes part of the interest earned by lenders | 10% of interest | On Morpho, the vault curator role is already a business of its own |
| Later: price feed and market-hours rules as a service | Other lending markets use our oracle and rules | Not decided | After there is a track record |

The numbers above are Q-07 and are decided before the production deployment.

An honest calculation: with a position cap of $500 and a fee of 0.10%, one transaction earns $0.50. Revenue only becomes meaningful if market depth and the position cap rise a lot. So in the early stage, the measure of success is not revenue, but funds lent, the number of positions, and market depth.

## How to get the first users

| Order | Who | Offer | Task |
|---|---|---|---|
| 1 | Current holders of aQQQ and aHOOD | Interest on the stocks they lend | X-17 |
| 2 | Market makers on the Uniswap and Monday Trade markets | Can borrow stock inventory | X-17 |
| 3 | Morpho users on Monad | A new USDC Earn vault with interest from stock buyers | X-15 |
| 4 | Users of xStocks and Aave when both are present | Leverage and short for the stocks they hold | X-18 |

Anchored stock holders on Monad are still very few. In the last two weeks before 13 October 2026 there were only 41 aNVDA transfers between 16 addresses. So the first users can be approached one by one.

### Market depth is the main bottleneck

All limits in this product follow market depth on the exchange. Without deeper markets, the product cannot grow. The available paths:

1. Register as an Anchored partner so that large liquidations can be swapped for the real stock, not sold on a thin exchange (X-12).
2. Invite market makers to borrow stock from our market and then quote prices on the exchange.
3. Add stocks from xStocks once their market exists (X-18).
4. Put part of the team treasury in as a liquidity provider on the exchange. This is risky and must be decided together (X-14).

## Metrics to watch after launch

| Metric | Meaning |
|---|---|
| Funds lent per market | Lender trust |
| Number and value of open positions | Usage |
| Active addresses per week | Growth |
| Number of liquidations compared to auto-deleverages | Whether market-hours protection works |
| Bad debt | Must be zero |
| Price impact at $300, $1,000, $10,000 | Market depth |
| Time from cross-chain deposit to first position | Ease of onboarding |
| Fee revenue | Present, but not the main measure at the start |

## Monad Metropolis submission package

The rules below come from a third-party copy of the competition rules. Check them on the official competition page before submitting (X-16).

| Item | Details |
|---|---|
| Track | 01, Onchain Finance & Trading |
| Submission deadline | 13 October 2026 at 23:59 ET, which is 14 October 2026 at 10:59 WIB |
| Judging | 14 to 27 October 2026 |
| Announcement | 3 November 2026 |
| Criteria | Five, each 20%: product quality and completeness, technical excellence, use of Monad, fit with the track, innovation and impact |
| Matching bounties | Aurora Intents ($5,000), Envio ($1,000) and Privy ($5,000). Not decided yet (Q-13) |

What must be there:

- [ ] Public repo with an open source license (proposal: MIT).
- [ ] README: what the product is, how to run it, contract addresses, real transaction hashes on Monad.
- [ ] Use of AI tools is stated in the README.
- [ ] Demo video of at most 3 minutes that shows real transactions on Monad.
- [ ] One project, one track.
- [ ] Team of 1 to 5 members, all aged 18 or older.

Suggested video outline:

1. The problem in two sentences: the stock exchange is closed, the token is not.
2. Deposit from another chain.
3. One confirmation: buy aQQQ with leverage. Show the transaction on the block explorer.
4. The soft limit changes when the market session changes.
5. Short in the same way.
6. Closing: four Monad services used at once, and user funds are never held by our programs.
