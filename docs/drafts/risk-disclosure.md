# Risk disclosure

Status: draft for task X-11, updated on 23 November 2026 for Base and X Layer. Not reviewed by legal counsel. Do not publish before review (X-10). Written in plain language on purpose.

## Read this before you use Levra

Levra runs on Monad, Base and X Layer. It lets you borrow to buy tokenized stocks, borrow tokenized stocks to sell them, and lend your assets for interest. All three can lose money. Use only money you can afford to lose.

## Risks when you borrow (long or short)

**You can be liquidated.** If the price moves against you and your loan passes the hard limit, anyone can repay your debt and take your collateral with a bonus on top. In markets with a 77% hard limit that bonus is about 7% of the repaid amount, and in markets with a 62.5% hard limit about 13%. You keep only what is left.

**Prices can jump while the market is closed.** The stock market closes on weekends and holidays, but your position stays open. When the market opens again the price can be far from where it closed. For example, in the last five years the largest such drop was about 5% for the Nasdaq-100 fund and about 18% for Robinhood. Single stocks can jump more than funds, and larger jumps are always possible.

**The protection feature is not a guarantee.** If you turn it on, Levra tries to reduce your position before the market closes when your loan is above the soft limit. It can fail if the market is too thin, if the price moves too fast, or if our systems are down. It is off unless you turn it on.

**You pay interest.** The rate changes with how much is borrowed and can rise sharply.

## Risks when you lend

**You can lose part of your deposit.** If a borrower's collateral is worth less than their debt after a sharp move, the loss is shared by the lenders of that market.

**You may not be able to withdraw right away.** If most of the pool is borrowed, you wait until borrowers repay or new lenders arrive.

## Risks that apply to everyone

**The price source can be late, stop, or be wrong.** On each chain the price that decides liquidation comes from one source: Anchored's oracle on Monad, Chainlink's feeds for the Coinbase stocks on Base, and the xStocks price feeds on X Layer. Quotes can be minutes behind the real market. If the source reports a wrong price, positions can be liquidated unfairly or not at all.

**When the price stops, some actions wait.** On holidays, and when a price source stops writing, the price goes stale. You can still close a position in full without a price. Opening, a partial close, taking collateral out and the protection feature wait until the price is fresh again. This has happened: Anchored's oracle on Monad stopped writing on 19 November 2026.

**The price on the exchange can differ from the real stock price.** Only parties registered with the issuer can swap tokens for real shares, so the token can trade above or below the real price for a long time. We have measured differences of up to 7%.

**The market is thin.** A trade of $1,000 can move the price by 3% to 5%. Large positions are costly to open, close or liquidate. Positions are capped for this reason.

**The issuer controls the tokens.** Each stock token is controlled by the company that issues it, not by Levra.

- On Base, one key held by the issuer can block any address for all Coinbase stocks at once, or pause their transfers. That address could be Morpho, the Levra contracts, or you.
- On X Layer, the xStocks issuer can add any address to its sanctions list, pause the tokens, or change how they work. These controls sit with multisig wallets of the issuer.
- On Monad, the issuer can block addresses and change how the tokens work.

If the issuer blocks or pauses, the stock cannot move. Closing, reducing and liquidating positions in that stock then fail, and your funds can be stuck for as long as the block lasts. A price can keep moving meanwhile, so lenders can lose money too. Levra cannot prevent or undo this. What Levra does: it keeps position sizes small, checks these controls every minute, alerts the holders of an affected stock, and stops new positions in it.

**Dividends and stock splits.** It is not yet clear how dividends reach tokens held in a lending contract, or how a stock split is applied. You may not receive a dividend on stock you posted as collateral.

**Smart contracts can have bugs.** Levra's contracts have not been audited yet. They and the protocols Levra uses (Morpho, and the exchanges KyberSwap, 1inch, Aerodrome, OKX DEX and Uniswap) can fail even after audits.

**Levra's team can change some settings.** The contracts are owned by a team multisig (2 of 3 signatures) behind a 2 day delay. Changing limits and fees waits 2 days, so you can see a change before it applies. The multisig can tighten limits or stop new positions at once. The team cannot move your funds or stop you from closing, reducing or adding collateral.

**Levra does not hold your funds.** Your collateral and debt sit in your own position in Morpho. This protects you from us, and it also means we cannot recover funds for you.

**Rules differ by country.** Tokenized stocks, margin lending and short selling are regulated. The tokens are meant for professional and qualified investors outside the issuer's prohibited jurisdictions. You are responsible for knowing whether you may use this product.

## What Levra is not

Levra is not a broker, a bank or an adviser. Nothing in the app is financial advice. Limits shown in the app are risk settings, not recommendations.
