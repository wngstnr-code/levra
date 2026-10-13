# Risk disclosure

Status: first draft for task X-11. Not reviewed by legal counsel. Do not publish before review (X-10). Written in plain language on purpose.

## Read this before you use Levra

Levra lets you borrow to buy tokenized stocks, borrow tokenized stocks to sell them, and lend your assets for interest. All three can lose money. Use only money you can afford to lose.

## Risks when you borrow (long or short)

**You can be liquidated.** If the price moves against you and your loan passes the hard limit, anyone can repay your debt and take your collateral with a bonus on top. For aQQQ that bonus is about 7% of the repaid amount, and for aHOOD about 13%. You keep only what is left.

**Prices can jump while the market is closed.** The stock market closes on weekends and holidays, but your position stays open. When the market opens again the price can be far from where it closed. In the last five years the largest such drop was about 5% for the Nasdaq-100 fund and about 18% for Robinhood. Larger jumps are possible.

**The protection feature is not a guarantee.** If you turn it on, Levra tries to reduce your position before the market closes when your loan is above the soft limit. It can fail if the market is too thin, if the price moves too fast, or if our systems are down. It is off unless you turn it on.

**You pay interest.** The rate changes with how much is borrowed and can rise sharply.

## Risks when you lend

**You can lose part of your deposit.** If a borrower's collateral is worth less than their debt after a sharp move, the loss is shared by the lenders of that market.

**You may not be able to withdraw right away.** If most of the pool is borrowed, you wait until borrowers repay or new lenders arrive.

## Risks that apply to everyone

**The price source can be late or wrong.** Stock prices come from one oracle run by the token issuer. Its quotes can be about 15 minutes behind the real market. If it stops or reports a wrong price, positions can be liquidated unfairly or not at all.

**The price on the exchange can differ from the real stock price.** Only parties registered with the issuer can swap tokens for real shares, so the token can trade above or below the real price for a long time. We have measured differences of up to 7%.

**The market is thin.** A trade of $1,000 can move the price by 3% to 5%. Large positions are costly to open, close or liquidate. Positions are capped for this reason.

**The issuer controls the tokens.** The issuer can block addresses, including the lending contract your collateral sits in, and can change how the tokens work. If that happens your funds could be stuck. Levra cannot prevent or undo this.

**Dividends and stock splits.** It is not yet clear how dividends reach tokens held in a lending contract, or how a stock split is applied. You may not receive a dividend on stock you posted as collateral.

**Smart contracts can have bugs.** Levra's contracts and the protocols it uses (Morpho, Uniswap, Monday Trade, KyberSwap) can fail even after audits.

**Levra does not hold your funds.** Your collateral and debt sit in your own position in Morpho. This protects you from us, and it also means we cannot recover funds for you.

**Rules differ by country.** Tokenized stocks, margin lending and short selling are regulated. The tokens are meant for professional and qualified investors outside the issuer's prohibited jurisdictions. You are responsible for knowing whether you may use this product.

## What Levra is not

Levra is not a broker, a bank or an adviser. Nothing in the app is financial advice. Limits shown in the app are risk settings, not recommendations.
