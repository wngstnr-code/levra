# 04. Risk rules

All limit numbers in this document are **initial proposals**. They must be tested and measured again before they are used with user money. This is not financial advice.

## Two layers of limits

| | Hard limit | Soft limit |
|---|---|---|
| Lives in | Morpho | Our `RiskManager` |
| Can be changed | No, never | Yes, through the multisig with a timelock |
| Applies to | Anyone who uses that market | Only those who go through `MarginRouter` |
| If crossed | The position is liquidated with a penalty | Cannot open or add to a position; gets a warning; auto-deleveraged if protection is on |
| Protects | Lenders | Borrowers |
| Follows market hours | No | Yes |

Important: the soft limit does not protect lenders. People can borrow directly on Morpho up to the hard limit without going through the router. What protects lenders is the hard limit, and the supply caps per market in the vault (see the section "Supply caps per market").

## Limits per stock

| Stock | Hard limit | Liquidation bonus | Soft limit, open | Soft limit, closed | Direction |
|---|---|---|---|---|---|
| aBIL | 91.5% | 2.6% | 90% | 90% | Long only |
| aQQQ | 77% | 7.4% | 73% | 70% | Long and short |
| aHOOD | 62.5% | 12.7% | 58% | 50% | Long and short |

The hard limit must be chosen from the list that Morpho provides on Monad: 38.5%, 62.5%, 77%, 86%, 91.5%, 94.5%, 96.5%, 98% (verified).

The liquidation bonus is set by Morpho from the hard limit:

```
bonus = min(15%, 1 / (1 - 0.3 × (1 - hard limit)) - 1)
```

Why aQQQ is 77% and not 86%: at 86% the bonus is only 4.4%, while selling $1,000 of aQQQ on the exchange (DEX) lowers the price by about 5%. Liquidators would lose money and would not want to work.

The soft limits for short use the same numbers as long as a starting point. That is more careful than needed, because upward gaps are smaller than downward gaps. It needs to be checked again (Q-15).

## Resulting maximum leverage

Long: leverage = stock value divided by margin. Maximum = 1 / (1 - soft limit).

Short: leverage = value of borrowed stock divided by margin. Maximum = soft limit / (1 - soft limit), because the sale proceeds also become collateral.

| Stock | Long, open | Long, closed | Short, open | Short, closed |
|---|---|---|---|---|
| aBIL | 10.0x | 10.0x | - | - |
| aQQQ | 3.7x | 3.3x | 2.7x | 2.3x |
| aHOOD | 2.4x | 2.0x | 1.4x | 1.0x |

Real numbers are a little lower because of price impact, fees, and the DEX-to-oracle deviation.

## Formulas

All these formulas are written once in `packages/shared/math.ts` and must match the contracts.

P is the stock price from the oracle in dollars.

### Long (stock collateral, USDC debt)

```
collateral value        = share count × P
LTV                     = debt / collateral value
liquidation price       = debt / (share count × hard limit)
distance to liquidation = 1 - LTV / hard limit       (price falls by this much)
LTV after gap g         = LTV / (1 + g)              (g is negative when price falls)
```

Example: margin $100, leverage 2x. Stock worth $200, debt $100. LTV 50%. Distance to liquidation = 1 - 0.50 / 0.77 = 35%.

### Short (USDC collateral, stock debt)

```
debt value              = share count × P
LTV                     = debt value / USDC collateral
liquidation price       = USDC collateral × hard limit / share count
distance to liquidation = hard limit / LTV - 1        (price rises by this much)
LTV after gap g         = LTV × (1 + g)
```

Example: margin $100, borrow stock worth $50 and sell it. Collateral becomes $150. LTV 33.3%. Distance to liquidation = 0.77 / 0.333 - 1 = 131%.

### Price scale for Morpho

Morpho asks for the price of 1 base unit of collateral in base units of the loan token, times 1e36. With an oracle price of 8 decimals (`p8`), USDC with 6 decimals, and stock with 18 decimals:

```
long market  (stock collateral, USDC loan):  price = p8 × 1e16
short market (USDC collateral, stock loan):  price = 1e56 / p8
```

Required test: for a price of $745.62, one share of aQQQ as collateral must be worth exactly 745.62 USDC according to Morpho.

### Price used

The Anchored oracle gives three numbers: price, best bid, and best ask.

| Market | Price used | Reason |
|---|---|---|
| Long | The lower of price and best bid | Collateral is valued carefully |
| Short | The higher of price and best ask | Debt is valued carefully |

If the best bid or best ask is zero or not sensible, use the price alone. The exact condition is the one in `SessionOracle`: for long, the best bid is used only when it is above zero and below the price; for short, the best ask is used only when it is above the price. `math.ts` uses the same condition (BE-16). Whether these two numbers are always filled is not verified (BE-03).

### Reducing a position to a target

For long, where V is collateral value, D is debt, t is the target LTV, and c is the cost of selling (price impact plus fees, as a fraction):

```
value of stock to sell = (D - t × V) / ((1 - c) - t)
```

Auto-deleverage target: the current soft limit minus 1 percentage point (initial proposal).

## Why only the Anchored oracle sets the hard limit

Decision D-03. The PDF suggests valuing collateral at the lower of the oracle price and the DEX price. For the hard limit in Morpho, that is dangerous:

- The market on the exchange (DEX) is very thin. $1,000 already moves the price by 3 to 5%.
- Only parties registered with Anchored can swap tokens for the real stock, so nobody can quickly bring the DEX price back to a fair price.
- As a result, someone could push the DEX price down with a small amount of money, trigger liquidation of others, and take the bonus.

So the DEX price is only used in the soft layer:

- The router rejects a transaction if its swap price deviates from the oracle by more than `maxDeviationBps`.
- The summary before confirmation shows the deviation.
- The LTV after the transaction is computed from the amount of stock actually received, so buying at a higher price than the oracle price shows up right away as a higher LTV.

| Stock | `maxDeviationBps` initial proposal | Deviation measured 13 October 2026 |
|---|---|---|
| aBIL | 100 (1%) | +0.1% |
| aQQQ | 500 (5%) | -2.6% |
| aHOOD | 1,000 (10%) | +7.1% |

## Oracle weaknesses

The Anchored oracle is the weakest point of this design. What we know and do not know:

| Item | Status |
|---|---|
| Live on Monad, gives price and market session for QQQ, HOOD, BIL | Verified |
| Price delayed 15 to 23 minutes when measured | Verified, one measurement. Anchored's documentation says the source quote can be about 15 minutes delayed |
| Controlled by one party and they can change it | Verified. It is an upgradeable proxy, and prices are written by an operator role held by Anchored |
| Best bid and best ask are positive and ordered | Verified by observation (BE-03, 4,603 writes, 29 September to 13 October 2026): always positive, bid never above ask, and the price always between them. 99th percentile spread: QQQ 16.6 bps, HOOD 46.9 bps, BIL 16.4 bps. Largest: HOOD 198 bps |
| How often the price is updated | Verified by observation (BE-03): about every 10 minutes in every open session. QQQ and HOOD: 95% of gaps at most 10.2 minutes. BIL is slower outside regular hours: 99th percentile gap up to 43 minutes after hours |
| What happens when the market is closed | Verified by observation (BE-03): over both weekends there were no writes at all for about 47.7 hours. `feedUpdateTimestamp` and `publishedAt` both stop. The price is carried forward |
| The schedule of each market session | Verified by observation (BE-03), US Eastern Time: sessions match 05. The session field changes on the first write after each boundary: about 04:15, 09:45 and 16:15, and 20:00 sharp. On Fridays the session flips between `POST_MARKET` and `CLOSED` many times from 20:00 to 20:15, then stays `CLOSED` until Sunday 20:00. No holiday is in the data yet |
| Source quote age outside `CLOSED` | Verified by observation (BE-03), 99th percentile and maximum: QQQ 25.0 and 26.8 minutes, HOOD 25.8 and 33.6 minutes, BIL 41.0 and 81.5 minutes. Full numbers in `docs/reports/oracle-2026-10-13.md` |
| Stock splits and other corporate actions | Not known. A split that changes the price per token without changing balances would liquidate positions. Asked in X-12 |

How this design withstands those weaknesses:

- **The hard limit gives room.** To profit from a stale price in the aQQQ market, the price would have to be wrong by more than 23%. In the aHOOD market, more than 37%. The worst five-year gaps are 5.4% and 17.8%.
- **Two max ages.** `SessionOracle` reverts if the price is older than the hard max age, which must be longer than the longest holiday if the oracle is not updated while closed. `RiskManager` rejects opening new positions if the price is older than `maxOracleAge`, which is much shorter.
- **Supply caps per market** limit the worst-case loss of lenders.
- **An oracle monitor** tells the team as soon as the price stops updating.

The hard max age cannot be filled in until BE-03 is done. Until then, `SessionOracle` is written with max age as a number set at deployment.

Max ages used by the deployment script, per market, chosen from the BE-03 data (D-35):

| Market | Hard source quote age while open | Hard publish age while closed | Age to open a position | Largest source quote age seen |
|---|---|---|---|---|
| QQQ | 1 hour | 4 days | 35 minutes | 26.8 minutes |
| HOOD | 1 hour | 4 days | 36 minutes | 33.6 minutes |
| BIL | 3 hours | 4 days | 51 minutes | 81.5 minutes |

The two hard ages live in `SessionOracle` and cannot be changed after deployment. The age to open a position lives in `RiskManager` and follows the automatic rule below, between 1,500 seconds and the hard source quote age.

Why BIL gets 3 hours: its feed is slow after hours, and at 1 hour its `price()` would have reverted at times, which blocks liquidations. A stale BIL price is a small risk, because the worst weekend move in five years was 0.4%.

Why 4 days while closed: `publishedAt` stops when the market closes, so this age measures time since the close. A normal weekend is about 48 hours and a holiday weekend about 72 hours. No holiday is in the data yet.

One risk the data shows: on Fridays the session flips between `POST_MARKET` and `CLOSED` for about 15 minutes after 20:00. If the last write before a weekend ever left the session as `POST_MARKET`, the open-market clock would apply all weekend and `price()` would revert after the hard source quote age, blocking liquidations until Sunday evening. Both observed weekends ended on `CLOSED`. The oracle monitor must alert on this (BE-50).

Staleness needs two clocks (decided in D-23). While the market is open, the right clock is `feedUpdateTimestamp`, the time of the source quote. Anchored suggests 1,500 seconds as the lowest sensible max age. While the market is `CLOSED`, `feedUpdateTimestamp` stops, so a max age on it would make `price()` revert all weekend and block liquidations. The proposal is: when the session is `CLOSED`, accept the carried price and judge freshness on `publishedAt`, the heartbeat.

What the BE-03 data means for these numbers (for Wangsit to decide, Q-28):

- BIL's source quote reached 81.5 minutes after hours, above the 1 hour hard age. With that setting, `price()` of an aBIL market would revert at those moments and block liquidations. QQQ and HOOD stayed under 34 minutes.
- `publishedAt` does not advance while `CLOSED`, so it measures time since the close, not a heartbeat. A normal weekend is about 48 hours, inside the 4 day setting. A long holiday weekend can reach about 72 hours. No holiday was observed yet.
- The 45 minute soft value is above the QQQ and HOOD data but below BIL's after-hours maximum, so opening an aBIL position would sometimes be refused after hours.
- Because the session flips on Friday evenings, any rule keyed on `CLOSED` switches on and off for about 15 minutes before it settles.

Values from the automatic rule below on this data (initial proposal): QQQ 35 minutes, HOOD 36 minutes, BIL 51 minutes.

### Automatic `maxOracleAge`

Decided in D-31. The rule's numbers are still an initial proposal. A keeper (BE-17) keeps `maxOracleAge` in line with the data from the oracle logger, so nobody has to change it by hand. It follows the open-market clock of D-23, because that is the clock `RiskManager` checks.

| Item | Rule |
|---|---|
| Input | Age of the source quote (block time minus `feedUpdateTimestamp`) per market, sampled in every session except `CLOSED`, from the BE-03 tables |
| Value | The 99th percentile of that age plus one heartbeat (10 minutes), rounded up to whole minutes, never below 1,500 seconds |
| Minimum data | 7 days, including one full weekend, and at least 500 samples per market |
| Before the minimum is met | No post. The value set at deployment stays |
| Smallest change worth posting | 10% of the value on chain |
| Bounds | `[minOracleAge, capOracleAge]` per market, set only by the multisig behind the timelock. The contract rejects anything outside them. The cap stays below the hard source quote age in `SessionOracle`, and the contract enforces that. The deployment script sets 1,500 to 3,600 seconds |

The bounds are what limits the damage of a leaked keeper key: the worst it can do is set the cap, which the multisig already accepted as safe.

Be careful: if `price()` reverts, Morpho cannot run borrowing, collateral withdrawal, or liquidation in that market. So a hard max age that is too short is as dangerous as one that is too long.

## Five-year price gap data

The difference between the closing price and the next opening price, for weekends and holidays only. 261 events per stock, October 2021 to October 2026, from Yahoo Finance.

| Stock | Gaps more than 2% | Worst drop | Worst rise |
|---|---|---|---|
| BIL | 0.0% | -0.4% | +0.1% |
| SPY | 1.9% | -4.0% | +3.0% |
| QQQ | 3.1% | -5.4% | +3.9% |
| AAPL | 6.1% | -9.4% | +6.7% |
| TSLA | 33.7% | -10.8% | +12.0% |
| NVDA | 23.4% | -14.2% | +4.6% |
| HOOD | 27.6% | -17.8% | +9.3% |
| MSTR | 52.9% | -27.4% | +14.8% |

The past does not guarantee the future. This table is a starting point, not a guarantee.

### Soft limit check when closed

A position that sits exactly at the soft limit at close, and then takes the worst five-year gap, must still stay below the hard limit.

| Market | Soft limit, closed | Worst gap | LTV afterwards | Hard limit | Safe |
|---|---|---|---|---|---|
| aBIL long | 90% | -0.4% | 90.4% | 91.5% | Yes |
| aQQQ long | 70% | -5.4% | 74.0% | 77% | Yes |
| aHOOD long | 50% | -17.8% | 60.8% | 62.5% | Yes, barely |
| aQQQ short | 70% | +3.9% | 72.7% | 77% | Yes |
| aHOOD short | 50% | +9.3% | 54.7% | 62.5% | Yes |

The open soft limit for aQQQ (73%) does not pass this check: 73% becomes 77.2% after the worst gap. This is on purpose. That is why the limit drops to 70% before close.

## Market hours rules

### When the "closed" limit applies

The soft limit uses the "closed" number if any of these is true:

1. The oracle reports session `CLOSED`.
2. The oracle reports session `UNKNOWN`.
3. The current time is inside the pre-close window: `nextCloseAt - preCloseWindow` to `nextCloseAt`.

Initial proposal for `preCloseWindow`: 4 hours.

### Where `nextCloseAt` comes from

The contracts do not know the calendar. A keeper, the "calendar poster", writes the next close time to `RiskManager`. The rules:

- Only times in the future, at most 8 days ahead.
- If the calendar poster is down, the limit still drops once the oracle reports `CLOSED`. Only the pre-close window is lost.
- Calendar source: the US exchange holiday schedule plus the Anchored session schedule. The exact Anchored session schedule is measured in BE-03.

### Pre-close timeline

| Time | What happens | By |
|---|---|---|
| 24 hours before close | First alert for positions above the "closed" limit | Alert keeper |
| 4 hours before close | Soft limit drops. Second alert. New positions above the "closed" limit are rejected | `RiskManager`, alert keeper |
| 1 hour before close | Final alert | Alert keeper |
| 30 minutes before close | Positions still above the limit with protection on are reduced | Protector keeper |
| After close | No auto-deleverage, because the DEX market may be too quiet | - |

The reduction is done before close, not after, because the DEX price is fairest while the real stock market is still open.

### Auto-deleverage fee

Initial proposal: at most 0.3% of the value reduced, to cover the keeper's transaction cost. Compare this with the liquidation penalty of 7.4% for aQQQ and 12.7% for aHOOD. The maximum is hard-coded in the contract.

## Position caps

The market on the exchange (DEX) is still thin, so a large position cannot be liquidated without a loss.

Rule for choosing the cap: the price impact of selling the whole position, plus any unfavorable DEX price deviation, must be smaller than the liquidation bonus.

| Stock | Bonus | Sell $300 | Sell $1,000 | DEX deviation | Cap per position, initial proposal |
|---|---|---|---|---|---|
| aBIL | 2.6% | -0.3% | -0.7% | +0.1% | $1,000 |
| aQQQ | 7.4% | -1.9% | -5.1% | -2.6% | $500 |
| aHOOD | 12.7% | -2.0% | -5.3% | +7.1% | $1,000 |

These numbers were measured on 13 October 2026 from aggregator quotes. The backend measures them again every day (BE-04) and the team raises a cap only if the rule above is still met.

To be honest about the effect: with caps this small, the product can only serve small positions at first. Caps go up only when market depth goes up.

## Supply caps per market

The USDC vault sends funds to the stock markets. Each market gets a maximum supply cap. That cap is the worst-case loss of lenders from one market.

| Market | Initial supply cap, proposal |
|---|---|
| aBIL long | $20,000 |
| aQQQ long | $10,000 |
| aHOOD long | $5,000 |

Caps are raised using the same rule as the position caps: following the measured market depth.

## Requirements for adding a new stock

A stock may be added if all of these are met:

1. It has a price and market session in the oracle we use.
2. There is a swap route in the aggregator, and selling $300 moves the price by less than 3%.
3. There is at least three years of price gap data for the real stock.
4. The hard limit is chosen so that the worst gap from the "closed" soft limit stays below it, and the liquidation bonus is larger than the price impact at the position cap.
5. The token can be held and moved by contracts (see SC-05).
6. There are starting funds to fill its market.

Adding a stock means deploying a new oracle, creating a new market on Morpho, and registering it in `RiskManager`. There is no code change.
