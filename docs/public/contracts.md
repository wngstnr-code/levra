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

The machine-readable list is [`contracts/deployments/monad.json`](../../contracts/deployments/monad.json).

The source of all nine contracts is verified on Sourcify with an exact match. Each one can be read at `https://repo.sourcify.dev/143/<address>`. The source is in [`contracts/src`](../../contracts/src) under the MIT license.

## Where your funds are

Your collateral and your debt sit in your own position on Morpho, under your own address. Levra's contracts hold no user funds between transactions. The router asks Morpho for a flash loan, swaps on the exchange, and puts the result into your Morpho position, all inside one transaction.

To do this, the router needs your authorization on Morpho. That authorization lets the router act on your Morpho positions. The router's code uses it in two cases only:

1. When you call the router yourself, on your own position.
2. When a keeper reduces your position, and only if you turned protection on for that market (see below).

## What cannot be changed by anyone

| Fact | Why |
|---|---|
| The contract code | None of the contracts is upgradeable. There are no proxies |
| The exchange the router and the liquidator may call | Fixed at deployment to the KyberSwap router `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` |
| The hard limit, the oracle and the interest rate model of each market | Morpho markets are immutable |
| How each `SessionOracle` reads the price, and its maximum price ages | The oracle has no owner and no settings |
| The fee ceiling | The trading fee can never exceed 0.50% and the keeper fee can never exceed 0.30% |
| Closing, reducing, repaying and adding collateral | No pause switch exists for them |

## Roles

| Role | Held today by | Can do |
|---|---|---|
| Owner | `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`, one team key | Everything in the next table |
| Guardian | Not set | Tighten soft limits and position caps, and pause new positions. Cannot loosen or resume |
| Keeper | Not set | Reduce a protected position, and call the liquidator |
| Calendar poster | Not set | Post the time of the next market close, at most 8 days ahead |
| Oracle age poster | Not set | Move the price age allowed for new positions, inside bounds set by the owner |

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

## Protection (auto-deleverage)

Protection is off by default. You turn it on per market with `setProtection(marketId, true)` on the router, and off again the same way.

With protection on, a keeper may sell part of your collateral to repay part of your debt. The router enforces all of the following:

- Only an address on the keeper list can do it.
- Only when your position is above the current soft limit.
- Your loan-to-value must be lower after the reduction.
- The sale price must be within the market's allowed deviation from the oracle price.
- The keeper fee is at most 0.30%.

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
