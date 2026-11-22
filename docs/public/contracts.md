# Levra contracts

Public reference for the Levra smart contracts on Monad mainnet (chain ID 143): where they are, who can change what, and how to leave without our app.

Status on 13 October 2026: staging. The contracts are live with small position caps and team money. They have not been audited. The limits are initial proposals, not tested values.

## Addresses

| Contract | Address | What it does |
|---|---|---|
| `MarginRouter` | [`0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6`](https://monadscan.com/address/0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6) | Opens and closes positions in one transaction |
| `RiskManager` | [`0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F`](https://monadscan.com/address/0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F) | Holds the soft limits and checks every new position |
| `Lens` | [`0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8`](https://monadscan.com/address/0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8) | Read-only view of positions and markets |
| `Liquidator` | [`0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39`](https://monadscan.com/address/0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39) | Liquidates unhealthy positions on Morpho |

Markets, all on Morpho (`0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee`):

| Market | Collateral | Borrowed | Hard limit | Morpho market ID | Oracle (`SessionOracle`) |
|---|---|---|---|---|---|
| QQQ long | aQQQ | USDC | 77% | `0xc391a3c7e7c7df45992777417850bf69212762549a251e192a5b9dcf2e607512` | `0xbec7D067ad0071AF3B500442537A7E7622C596d3` |
| HOOD long | aHOOD | USDC | 62.5% | `0xccd3e44829842941d7074237a999b318d999c29cb770ed4d067259a52c2f3edd` | `0xB8E3ec1BCd1988D5aD35d0A0219F767944737465` |
| BIL long | aBIL | USDC | 91.5% | `0xcf2268fd4347fe5f5c3278d1a17e8ebd1995de0eaae3ac7bd71afbbaad6a1415` | `0x2Fd501ae3Cf16DDe20322b0985A96A53f195640B` |
| QQQ short | USDC | aQQQ | 77% | `0xc54a4e80aecb068c56d9e79a770d68140dcad9747132af34f086f4ff907c3262` | `0xB08Cb2B0ba10E6a8A3e5Bda7a240a9c6E6CF6bC7` |
| HOOD short | USDC | aHOOD | 62.5% | `0x53ce3f8e5560d6f80e9a219b35a9cd54472f89f75c8c970bc504a6c21391e033` | `0xaFe518da5cBa30B198e96F26074f66f85241DE95` |

The USDC vault for lenders:

| Contract | Address | What it does |
|---|---|---|
| `Levra USDC` (`lvUSDC`) | [`0xfB99A7E3f5571baA363d67F7823bb354cfd95447`](https://monadscan.com/address/0xfB99A7E3f5571baA363d67F7823bb354cfd95447) | Takes USDC deposits and lends them to the three long markets |

The machine-readable list is [`contracts/deployments/monad.json`](../../contracts/deployments/monad.json).

The source of all nine contracts is verified on Sourcify with an exact match. Each one can be read at `https://repo.sourcify.dev/143/<address>`. The source is in [`contracts/src`](../../contracts/src) under the MIT license.

## Addresses on Base

Base mainnet (chain ID 8453), deployed on 22 November 2026. Not audited. The limits are initial proposals. Ownership is moving from the deployer `0x7C7b6639d9cb9Eb691de0Eb90146ff77cde947D0` to a 2 day timelock [`0xA0089B68a8CFf4d810985DF8503815b3d1344c67`](https://basescan.org/address/0xA0089B68a8CFf4d810985DF8503815b3d1344c67) run by the team Safe `0x5e40f4Be2dEF4900Aa7BBe0eb8B7ba733c1Cf069`; the vault goes to the Safe directly. Until the Safe accepts, the deployer is still the owner.

| Contract | Address | What it does |
|---|---|---|
| `MarginRouter` | [`0xf5585feA7aeDC5e148201052f73139111810aA88`](https://basescan.org/address/0xf5585feA7aeDC5e148201052f73139111810aA88) | Opens and closes positions in one transaction |
| `RiskManager` | [`0x8354ff472d87C942f9186acc83e0600424272594`](https://basescan.org/address/0x8354ff472d87C942f9186acc83e0600424272594) | Holds the soft limits and checks every new position |
| `Lens` | [`0xa8d15000992Cd055E7731E884D91b16F2123A327`](https://basescan.org/address/0xa8d15000992Cd055E7731E884D91b16F2123A327) | Read-only view of positions and markets |
| `Liquidator` | [`0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7`](https://basescan.org/address/0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7) | Liquidates unhealthy positions on Morpho |

Markets, all on Morpho (`0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`). The stock is the Coinbase B20 token; the oracle is a `ChainlinkSessionOracle` over Chainlink's Coinbase feed:

| Market | Collateral | Borrowed | Hard limit | Morpho market ID | Oracle |
|---|---|---|---|---|---|
| AAPL long | the stock | USDC | 77% | `0x7934723c6cc42d5f2bd3c58af4fc14bf0b5ae38245638adabf2052032967b398` | `0xDF21F507676cF34F78080a7eAAeD967E741fDD00` |
| AMZN long | the stock | USDC | 77% | `0x23c5324881859a2163ff984d67449fa0f1c0e12f3c52a4dbbbfb4b3313c3f38c` | `0x6964d40b507c6da717334eAe7B775C9F365d576D` |
| GOOGL long | the stock | USDC | 77% | `0x45059d2328299056d05545d0368c8b0d34397047820a0d46b7775275375c76b2` | `0x112e34bFD7B39e3790B435Afb825a980E0512355` |
| META long | the stock | USDC | 77% | `0x6cf665db25bb5a59615cceffed97e527cfe0183f08176c568fc9c939f91b6647` | `0x7DB3B3de66Dd60D26ca9aEDc4378cE2Fa2D837BD` |
| MSFT long | the stock | USDC | 77% | `0xba887b01160863891d76a273f5dbab6efc6dbe3df5a732ee112313da5aba7ff7` | `0x04Cb51598F7b7B78dd46BF26766256Fe1f8EeA88` |
| NVDA long | the stock | USDC | 62.5% | `0x34b62b714803c0121c14ce767b8de3a1d87460f41c662b927dd2bc1527316876` | `0xf256b7b9Ef29eF2A279052209F686f66BA952987` |
| SPCX long | the stock | USDC | 62.5% | `0xc22d1bc9f71832e1f83eedbecdb45980381176f8889f7b697c2bf6de6223c242` | `0xb96F27C67e626C9931c58fa01bF8F8ED08acE28a` |
| TSLA long | the stock | USDC | 62.5% | `0xd62e941889f385ac51cc825c72a2ea04e7c8e02ceb68c141d0b0a7d17fbf01c9` | `0xe8aD8d1Bbbd8e3A0BBb5c1Bc600318ffb4AD073D` |
| AAPL short | USDC | the stock | 77% | `0x8fed1ed63e26d4997525ab68f67a58878eb481b711ebf0f560054885a25226e6` | `0xA000362E65E1e92D14Df46df035CbdC8E75Bb67F` |
| AMZN short | USDC | the stock | 77% | `0xf6d5949b6bea4691073b7ce82d431f73a73bc6fdd98499e79e8e8e12441b4175` | `0xce171c460929433640f58dC5d3e9746Db00b420e` |
| GOOGL short | USDC | the stock | 77% | `0x5aa5136108ae13ef4ebbc91faada6ae1ad47d07c9c8d77290e76c388446253a9` | `0x4A6f3c95919E21EB03437D5A90813C59Ab5d4D76` |
| META short | USDC | the stock | 77% | `0x11a4175314b1b174363dbdea13b6f2bc8277c947953b7a4cf01eb32a984126dd` | `0x0f67ca2C7D1f0a6B1AC513492d049886949A1ca1` |
| MSFT short | USDC | the stock | 77% | `0x5f57cf8280964dc2a851e5c8d6da850227b9aec1f1791292fc024bbb6646bda8` | `0x87EfBB7e351F36fC51280d79a9Cb82c109c42A4C` |
| NVDA short | USDC | the stock | 62.5% | `0x869c760367a10b076bc0206b63d003cc519f994b14d6aad61b976ac15a52e080` | `0x8626edD94FA49c30D5b04c0e0E52e5B50Db3d8cc` |
| SPCX short | USDC | the stock | 62.5% | `0x0ae42283dd827b92d084ef5b64a7fe8e145b5216718b17c6addd36fbf5c6e581` | `0x86a124066493dc5d84da4C63Ba06BEF4461bAe7E` |
| TSLA short | USDC | the stock | 62.5% | `0x8430223a3d5943137fd3924fedbb90d3c2e250270f07bceaebce1a427e792b0d` | `0x0AEE0870183D9c2b27A52b24123022D9AD33E1f4` |

The USDC vault for lenders on Base:

| Contract | Address | What it does |
|---|---|---|
| `Levra USDC` (`lvUSDC`) | [`0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8`](https://basescan.org/address/0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8) | Takes USDC deposits and lends them to the eight long markets |

The machine-readable list is [`contracts/deployments/base.json`](../../contracts/deployments/base.json). All 20 contracts are verified on Basescan and on Sourcify (exact match).

## Addresses on X Layer

X Layer mainnet (chain ID 196), deployed on 22 November 2026, at the same contract addresses as on Base. Not audited. The limits are initial proposals. Ownership is still with the deployer `0x7C7b6639d9cb9Eb691de0Eb90146ff77cde947D0` and moves to a timelock run by the team Safe `0x5e40f4Be2dEF4900Aa7BBe0eb8B7ba733c1Cf069` next.

| Contract | Address | What it does |
|---|---|---|
| `MarginRouter` | [`0xf5585feA7aeDC5e148201052f73139111810aA88`](https://web3.okx.com/explorer/x-layer/address/0xf5585feA7aeDC5e148201052f73139111810aA88) | Opens and closes positions in one transaction |
| `RiskManager` | [`0x8354ff472d87C942f9186acc83e0600424272594`](https://web3.okx.com/explorer/x-layer/address/0x8354ff472d87C942f9186acc83e0600424272594) | Holds the soft limits and checks every new position |
| `Lens` | [`0xa8d15000992Cd055E7731E884D91b16F2123A327`](https://web3.okx.com/explorer/x-layer/address/0xa8d15000992Cd055E7731E884D91b16F2123A327) | Read-only view of positions and markets |
| `Liquidator` | [`0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7`](https://web3.okx.com/explorer/x-layer/address/0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7) | Liquidates unhealthy positions on Morpho |

Markets, all on Morpho. The stock is the wrapped xStock; the oracle is a `ChainlinkSessionOracle` over the xStocks price feed:

| Market | Collateral | Borrowed | Hard limit | Morpho market ID | Oracle |
|---|---|---|---|---|---|
| GOOGL long | the stock | USDC | 77% | `0x5f8fcdef7968590c7058067757d18d99bb7e143d86fbb3a6f44d1e47cc470cd3` | `0xDF21F507676cF34F78080a7eAAeD967E741fDD00` |
| NVDA long | the stock | USDC | 62.5% | `0x198bc6185b1da4e17abc2eba61a01d60c07959cb9a31ac5ce6dc6985835871d9` | `0x6964d40b507c6da717334eAe7B775C9F365d576D` |
| QQQ long | the stock | USDC | 77% | `0x5c544c155f3c2ca375b8cb80faecb05f5b0e7a59654302fec365c5ab230d649f` | `0x112e34bFD7B39e3790B435Afb825a980E0512355` |
| SPY long | the stock | USDC | 77% | `0x2b3aa5ead3faedc052f997864164a95f2c129ae5ac3b848bfc36b5b77a3c4206` | `0x7DB3B3de66Dd60D26ca9aEDc4378cE2Fa2D837BD` |
| GOOGL short | USDC | the stock | 77% | `0x6efe0004b4ca99b217c9bc9f762cf100b218329986badb9b3d98c53cdcdb0100` | `0x04Cb51598F7b7B78dd46BF26766256Fe1f8EeA88` |
| NVDA short | USDC | the stock | 62.5% | `0x34879d26e0cb222ee47260d4a8046bdf983b09bbb4077abba127451d9d364f85` | `0xf256b7b9Ef29eF2A279052209F686f66BA952987` |
| QQQ short | USDC | the stock | 77% | `0x831dc8cdce8fd98f567a5e397830a8b89847a7a9d9cf7603e475c2177a2e5413` | `0xb96F27C67e626C9931c58fa01bF8F8ED08acE28a` |
| SPY short | USDC | the stock | 77% | `0xa403cfaa81f30eae48fd68c6bd2705ecd3c5b0da892e343a48bf3e710ad94282` | `0xe8aD8d1Bbbd8e3A0BBb5c1Bc600318ffb4AD073D` |

There is no USDC vault on X Layer: Morpho has no MetaMorpho factory there, so lenders supply directly to a market (D-84). The machine-readable list is [`contracts/deployments/xlayer.json`](../../contracts/deployments/xlayer.json). All 12 contracts are verified on Sourcify (exact match).

## Where your funds are

Your collateral and your debt sit in your own position on Morpho, under your own address. Levra's contracts hold no user funds between transactions. The router asks Morpho for a flash loan, swaps on the exchange, and puts the result into your Morpho position, all inside one transaction.

To do this, the router needs your authorization on Morpho. That authorization lets the router act on your Morpho positions. The router's code uses it in two cases only:

1. When you call the router yourself, on your own position.
2. When a keeper reduces your position, and only if you turned protection on for that market (see below).

## What cannot be changed by anyone

| Fact | Why |
|---|---|
| The contract code | None of the contracts is upgradeable. There are no proxies |
| The exchange the router and the liquidator may call | Fixed at deployment to the KyberSwap router `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`. New deployments take one to three exchange addresses, each with the one address allowed to pull the tokens for it, all fixed forever (D-79, D-88) |
| The hard limit, the oracle and the interest rate model of each market | Morpho markets are immutable |
| How each `SessionOracle` reads the price, and its maximum price ages | The oracle has no owner and no settings |
| The fee ceiling | The trading fee can never exceed 0.50% and the keeper fee can never exceed 0.30% |
| Closing, reducing, repaying and adding collateral | No pause switch exists for them |

## Roles

| Role | Held today by | Can do |
|---|---|---|
| Owner | `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`, one team key | Everything in the next table |
| Guardian | Not set | Tighten soft limits and position caps, and pause new positions. Cannot loosen or resume |
| Keeper | `0x3BcB6A6c1d21d229bF8d5Ea5524b3d1aEe3b841e` on the router, `0x22ea6605a7D5246b1F05831632DC8172125A5C18` on the liquidator | Reduce a protected position, and call the liquidator |
| Calendar poster | `0x745356C469FcE1372B4C2259332f5251130d4a5b` | Post the time of the next market close, at most 8 days ahead |
| Oracle age poster | `0x33B03c6e569e06938D59F1232ef5070646F0146d` | Move the price age allowed for new positions, inside bounds set by the owner |

The owner is a single key today. The plan is a 2-day timelock controlled by a team multisig, with the multisig as guardian. The script for this handover is written and tested, and waits for the multisig.

### What the owner can do

| Action | Limit |
|---|---|
| Change a market's soft limits, position cap, allowed price deviation, and whether new positions are allowed | The soft limit must stay below the market's hard limit |
| Pause and resume new positions | Affects opening only |
| Change the trading fee, the keeper fee and the fee recipient | At most 0.50% and 0.30%. Today 0.10% and 0.30% |
| Add and remove keepers, and set the guardian and the two posters | |
| Change the window before the market close in which the stricter soft limit applies | At most 1 day. Today 4 hours |
| Set the bounds for the oracle age poster | Never above the oracle's own maximum age |
| Move the liquidator's treasury address and withdraw tokens held by the liquidator | The liquidator holds team funds only |

### What the owner cannot do

- Move, freeze or seize your collateral or your debt.
- Stop you from closing, reducing, repaying or adding collateral.
- Change the hard limit at which Morpho allows liquidation.
- Point the router at a different exchange or a different Morpho.
- Reduce your position, unless you turned protection on, and then only through a keeper under the rules below.

A stricter soft limit does not close existing positions. It blocks new positions above it, and it lets a keeper reduce positions that have protection on. Taking collateral out, or a partial close that raises your loan-to-value, must also end at or below the soft limit. A full close is always allowed.

## The USDC vault

The vault is a MetaMorpho v1.1 vault created from Morpho's own factory (`0x33f20973275B2F574488b18929cd7DCBf1AbF275`). Its code is Morpho's, not ours. Deposits are lent to the QQQ, HOOD and BIL long markets, in that order, and nowhere else.

| Setting | Value today | Who can change it |
|---|---|---|
| Supply cap per market | 10,000 USDC for QQQ, 5,000 for HOOD, 20,000 for BIL | The owner. Lowering is immediate. Raising, or adding a market, waits for the timelock |
| Fee | 10% of the interest earned | The owner, at most 50% by Morpho's rule |
| Timelock | 1 day | The owner can lengthen it, up to 2 weeks. Morpho's code does not allow less than 1 day |
| Owner | `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`, the same single team key | Moves to the multisig with the other contracts |
| Curator, guardian | Not set | The owner |

The owner cannot withdraw lenders' deposits. The owner does choose which markets the vault lends to, and a bad choice could lose deposits. A new market can be added only after the timelock, so lenders have 1 day to leave if they disagree. No guardian is set yet, so nobody can veto such a change during that day.

A lender can withdraw only what is not lent out at that moment. When a market is fully borrowed, withdrawals wait until borrowers repay or new deposits arrive.

## Protection (auto-deleverage)

Protection is off by default. You turn it on per market with `setProtection(marketId, true)` on the router, and off again the same way.

With protection on, a keeper may sell part of your collateral to repay part of your debt. The router enforces all of the following:

- Only an address on the keeper list can do it.
- Only when your position is above the current soft limit.
- Your loan-to-value must be lower after the reduction.
- The sale price must be within the market's allowed deviation from the oracle price.
- The keeper fee is at most 0.30%.
- The keeper must leave part of your debt in place: a reduction ends at most 5 percentage points below the soft limit, never closes the position in full, and may only take out collateral worth about the debt it repays.
- The keeper cannot act while the market is closed for the weekend.

With protection off, nobody but you can touch your position through Levra. Morpho's own liquidation still applies above the hard limit, as for every Morpho borrower.

## Leaving without the Levra app

Your position is a normal Morpho position. You do not need Levra to manage or exit it.

**Revoke the router's authorization.** Call Morpho directly:

```bash
cast send 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee \
  "setAuthorization(address,bool)" 0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6 false \
  --rpc-url https://rpc.monad.xyz --account <your-account>
```

Check it:

```bash
cast call 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee \
  "isAuthorized(address,address)(bool)" <your-address> 0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6 \
  --rpc-url https://rpc.monad.xyz
```

After revoking, the router can no longer open, close or reduce your positions, and protection stops working. Your positions stay where they are. To use the router again, authorize it again.

**Remove a token allowance.** If you approved USDC to the router, set it back to zero with `approve(0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6, 0)` on the USDC token `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`.

**Close a position directly on Morpho.** Repay the debt with `repay`, then take the collateral out with `withdrawCollateral`, using the market parameters of your market. For a long you repay USDC and receive stock tokens. For a short you repay stock tokens and receive USDC.

## Risks outside our contracts

- **The stock tokens.** Anchored issues them. Its contracts are upgradeable and have a denylist. If Anchored blocks Morpho or changes a token, collateral could be locked. Our code cannot prevent this.
- **The price.** The hard limit uses the Anchored oracle only. If that oracle stops or reports a wrong price, liquidations can be late or wrong.
- **Market hours.** Stocks do not trade all week, but the tokens do. A price can jump when the market reopens, and a position can pass the hard limit without a chance to react.
- **Liquidity.** The exchange pools for these tokens are small. Large positions move the price, and a position may close at a worse price than the oracle shows.
- **Morpho and KyberSwap.** Levra relies on both working as designed.
- **No audit yet.** These contracts are tested by the team only.

## Audit

No audit has been done. This section will link the report when there is one.

## Security contact

See [the bug bounty draft](../drafts/bug-bounty.md). The private reporting channel is not open yet.
