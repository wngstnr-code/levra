# 01. Product

## Goal

Build a margin account for tokenized stocks on Monad that is ready for real people to use with real money. The measure is not "it can be demoed", but "it can be opened to the public and run as a business".

We do not build an exchange and we do not build a lending venue. Trading happens on Uniswap and Monday Trade, found through the KyberSwap aggregator. Lending and borrowing happen on Morpho. Deposits from other networks go through Aurora Intents. Stock prices come from the Anchored oracle.

What we build is three things that do not exist yet:

1. **A price source that knows market hours.** It reads the stock price and the market session (open, overnight, closed), in a form Morpho can use.
2. **Borrow limit rules.** A limit for each stock, calculated from five years of price gap data, and changing with market hours.
3. **A one-confirmation account.** The user picks a stock, a direction, an amount, and the size of the loan. The program runs all the steps in one confirmation. Funds stay recorded under the user's name on Morpho.

## Users

| User | What they look for | Feature that serves them |
|---|---|---|
| Trader | Leverage or short on real stocks, not imitation contracts | Long, Short |
| Market maker | Stock inventory to quote sell prices | Borrowing stock (Short without selling, see note) |
| Tokenized stock holder | Extra interest on the stocks they hold | Earn stock |
| Digital dollar holder | Interest from lending dollars | Earn USDC |

Note for market makers: borrowing stock without selling it right away can be done directly on Morpho. Our app shows the market and the position, but a special flow is not needed in the first version.

Restriction from the issuer: Anchored aims its tokens at professional and qualified investors and publishes a list of prohibited jurisdictions that includes the United States, China and Canada (full list in 05). Our product must respect that restriction (see 08-startup-readiness.md, legal section).

## Scope of the final version

### What is included

| Part | Contents |
|---|---|
| Long | aQQQ, aHOOD, aBIL. Open, add collateral, reduce, close |
| Short | aQQQ, aHOOD. Open, add collateral, reduce, close |
| Earn | USDC through a vault that we manage. Stocks (aQQQ, aHOOD) go directly to their lending market |
| Sign-in | With an existing wallet, or without one through email or passkey (D-16) |
| Cross-chain deposit and withdrawal | From and to other networks through Aurora Intents, with USDC on Monad |
| Market-hours protection | A changing soft limit, warnings, and auto-deleverage for those who allow it |
| Liquidation | Our own liquidator bot, so the market stays healthy even when no one else is there |
| Account | Positions, health, profit and loss, history, price gap simulation |
| Compliance | Geo-blocking, terms of use approval, risk disclosure |
| Operations | Monitoring, alerts for the team, a status page, an incident playbook |
| Security | Full testing, external audit, shared key (multisig) with a timelock |

### What is intentionally not included

| Not built | Reason |
|---|---|
| Own exchange or order book | Decision D-01: use existing exchanges |
| Own lending venue | Decision D-01: use Morpho |
| Holding user funds | Decision D-02: funds stay in the user's own Morpho position |
| Combined collateral across markets | Morpho markets are separate from each other. "One account" means one view and one way of using it, not one collateral pool |
| Stocks with no market on a Monad exchange | 24 of the 28 Anchored stocks checked have no route. Added when they meet the requirements in 04-risk-rules.md |
| Short aBIL | Useless for a short-term bond fund (D-11) |
| Perpetual futures (perps) | Not this product |
| Native mobile app, card purchases, own token | Out of scope |

## Seven user flows

The example numbers use aQQQ: hard limit 77%, soft limit 73% when the market is open and 70% when it is closed.

### Flow 1. Sign in and deposit

1. The user opens the app. The app checks their region and asks for approval of the terms of use on the first visit.
2. The user signs in with an existing wallet, or with email or passkey if they have no wallet (D-16). In the second case the app creates a wallet that only the user controls.
3. The user chooses where the funds come from: already on Monad, or from another network.
4. If from another network: the app shows one deposit address and the estimated amount that will arrive. The user sends the funds from any wallet.
5. The app shows the status of the transfer until the funds arrive on Monad as USDC in the user's wallet. A little MON for transaction fees is sent along if the user does not have any.

Rule: funds arrive in the user's own wallet, not in our program.

### Flow 2. Long (buy with a loan)

1. The user chooses a stock, then Long.
2. They enter an amount of money (for example $100) and the leverage (for example 2x).
3. The screen shows a summary before confirmation:
   - the stock received and its value,
   - the debt,
   - the buy price on the exchange compared to the real stock price, with the difference in percent,
   - fees,
   - the borrow limit after the transaction compared to the soft limit and hard limit,
   - the liquidation price and its distance from the current price,
   - what happens if the market opens with the worst price gap of five years.
4. The user presses confirm. On first use, the needed approvals are combined into the same confirmation if the wallet supports it.
5. The program borrows USDC, buys the stock on the exchange, and supplies it as collateral on Morpho under the user's name.
6. The position appears on the Positions page.

Example: $100 with 2x leverage gives about $200 of stock and $100 of debt. The position is liquidated if the price falls about 35%.

### Flow 3. Short (profit when the price falls)

1. The user chooses a stock, then Short.
2. They enter the collateral (for example $100 USDC) and the value of the stock to borrow (for example $50).
3. The screen shows a summary: debt in shares, borrow interest, sell price compared to the real stock price, liquidation price.
4. The user presses confirm.
5. The program supplies the collateral, borrows the stock, and sells it on the exchange. The sale proceeds also become collateral (D-05).
6. If the price falls, buy the stock back cheaper. The difference is the profit.

Example: collateral $100 and borrowed stock worth $50. The collateral becomes about $150, so the LTV is 33%. The position is liquidated if the price rises about 131%.

Difference from the PDF: in the PDF this example says "rises about 54%" because the sale proceeds are assumed not to be kept. In this design the sale proceeds are kept as collateral, so the position is safer.

### Flow 4. Earn (lend for interest)

1. The user chooses Earn, then the asset: USDC or a stock.
2. The screen shows the current interest, what percent of funds is being borrowed, and how much can be withdrawn now.
3. The screen shows the risk clearly: if a borrower's position loses more than its collateral, the loss is borne by the lenders.
4. The user enters an amount and presses confirm.
5. Interest grows automatically. The deposit can be withdrawn at any time as long as the funds are not all being borrowed.

### Flow 5. Monitor and close

1. The Positions page shows for each position: value, debt, profit and loss, LTV, distance to the liquidation price, and protection status.
2. The user can add collateral, take out some collateral, reduce the position, or close it fully.
3. When closing, the program sells the stock (or buys it back for a short), repays the debt, and sends the rest to the user's wallet.

Rule: closing and reducing a position must always be possible, including when the team stops opening new positions.

### Flow 6. Before the market closes

1. A few hours before the market closes for the weekend or a holiday, the soft limit goes down, for example from 73% to 70%.
2. Users whose position is over that limit get a warning in the app and through the channel they chose.
3. They can add collateral or reduce the position themselves.
4. If they do nothing and they have turned on protection, the program reduces their position just enough to get back under the soft limit. The cost is much smaller than the liquidation penalty.

Rule: automatic protection is off by default. The user must turn it on themselves for each market.

### Flow 7. Liquidation

1. The price moves against the user until it passes the hard limit.
2. Another party, including our liquidator bot, repays the debt and takes the collateral with a bonus (about 7% for aQQQ).
3. The user receives the remaining collateral if there is any.
4. The app explains what happened in the position history.

This happens on Morpho, not in our program. The job of flow 6 is to prevent the user from reaching this point.

## What must always be shown to the user

This is part of the product, not decoration. Without it, users can lose money without knowing why.

| Item | Where | Why |
|---|---|---|
| Market session (open, overnight, closed) | On all pages | Limits and risk depend on it |
| Difference between the exchange price and the real stock price | Summary before confirmation, market page | On 13 October 2026 the difference was up to 7% for aHOOD |
| Price impact from the size of the trade | Summary before confirmation | The market is thin: $1,000 moves the price 3 to 5% |
| Age of the oracle price | Market page, warning if too old | The Anchored price is delayed 15 to 23 minutes |
| Liquidation price and gap simulation | Summary and Positions page | The core of this product |
| Position cap | Form | Positions are capped while the market is still thin |

## Definition of "done" for the final version

The product is considered done when all of this is true:

1. All seven flows work on Monad mainnet with real money, for all stocks in scope.
2. People outside the team can complete flows 1 to 5 without help.
3. Market-hours protection has been proven to work through at least one real weekend close.
4. The liquidator bot has been proven to close a test position that was made unhealthy on purpose.
5. All launch requirements in 08-startup-readiness.md are met, including the audit.
6. There is no mock data, no button that does not work, and no half-finished feature in the app.
