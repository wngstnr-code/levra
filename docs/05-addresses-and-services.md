# 05. Addresses and services

All addresses here were taken from official documentation or from the services' own responses, then confirmed to have code on Monad mainnet on 13 October 2026. The binding source for code is `packages/shared/addresses.ts`. If they differ, the code file is right and this document is fixed.

Check every address again before using it to deploy with real money.

## Network

| Item | Value |
|---|---|
| Name | Monad, mainnet |
| Chain ID | 143 |
| Block time | 300 milliseconds |
| Finality | 600 milliseconds |
| Public RPC endpoint used for measurements | `https://rpc2.monad.xyz` |
| Limits of that RPC endpoint | 300 requests per 10 seconds; range of 10,000 blocks for reading events |
| Fee currency | MON |

Production uses a paid RPC endpoint provider. The choice is task BE-15.

## External services on Monad

| Name | Address | Notes |
|---|---|---|
| Morpho (core) | `0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee` | 130 markets, $134.2 million supplied, $117.3 million borrowed |
| Morpho, interest rate model (AdaptiveCurveIrm) | `0x09475a3D6eA8c314c592b1a3799bDE044E2F400F` | The only one we use |
| Morpho, Chainlink oracle factory | `0xC8659Bcd5279DB664Be973aEFd752a5326653739` | Not used; we deploy our own oracle |
| KyberSwap, aggregator router | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | Swap target in the router allowlist |
| Monday Trade, SwapRouter | `0xFE951b693A2FE54BE5148614B109E316B567632F` | Backup for aBIL |
| Monday Trade, QuoterV2 | `0xB97eCD41Aef0F842E773C8F9905919cDE49880C9` | |
| Monday Trade, Factory | `0xC1e98D0A2a58fB8aBd10ccc30a58efff4080Aa21` | |
| Anchored, stock price oracle | `0x037848af338c38e1e0ab722be80bf4c2e612a1f7` | A proxy, can be changed by Anchored |
| Chainlink, wNVDAx-USD | `0x03ffa4673c060339E6a8E5Ba1a12B3301c966bf0` | For reference only; not used |

Not yet looked up and must be confirmed in SC-06: Morpho vault factory, Morpho public allocator, Safe (multisig), Permit2, Multicall3.

## Tokens

| Token | Address | Decimals |
|---|---|---|
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | 6 |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | not read yet |
| USDT0 | `0xe7cd86e13AC4309349f30B3435a9d337750fC82D` | not read yet |
| aQQQ | `0x1446501E886c7f830DB9b494A1890cBCCC072f57` | 18 |
| aHOOD | `0x5a4860adDCc094FcE026384caeEcb1e634DD9af4` | 18 |
| aBIL | `0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f` | 18 |
| aNVDA | `0x701193374879131f923532987c7Ef363a91a80eB` | 18 |

Our dollar loan and collateral currency is USDC (D-06), because that is what is available through Aurora Intents. AUSD is not in the Aurora Intents token list.

AUSD and USDT0 are not used. Read their decimals from the network first if they are ever used.

## Exchange (DEX) markets

| Stock | Exchange | Pool ID |
|---|---|---|
| aQQQ | Uniswap v4 | `0xb02cb6d8fa49ff9c9cf7576a231ccf335e33b2be1defa3c7c91b03cf86fcabe9` |
| aHOOD | Uniswap v4 | `0x5a5bd831053340c8f51021866464fc9672314d54eb6e7b92bdb2afa85b3cb80c` |
| aBIL | Monday Trade v3 | `0x158d9dc39a3be0f2ce759deadbf18bae20dcf9d9` |

Not verified (SC-04):

- The paired token in each pool (USDC, AUSD, or something else). The aggregator can route through other tokens, but that adds price impact.
- Whether those Uniswap v4 pools have extra rules (a hook). The aggregator does not report it, but it has not been read from the contract.
- No real swap transaction has been run yet. So far there are only quotes.

## Anchored oracle

```solidity
function latestPrice(bytes32 priceId) external view returns (PricePayload memory);

struct PricePayload {
    int128 price;
    int128 bestBid;
    int128 bestAsk;
    uint64 feedUpdateTimestamp;
    uint64 publishedAt;
    uint80 roundId;
    Session session;
}

enum Session { UNKNOWN, PRE_MARKET, REGULAR, POST_MARKET, OVERNIGHT, CLOSED }
```

- `priceId` is the `keccak256` of the uppercase symbol, for example `keccak256("QQQ")`.
- Prices have 8 decimals.
- The layout above was recorded from a read on 13 October 2026. Confirm it again against the ABI on the block explorer before writing `SessionOracle` (part of SC-10).

## Morpho interface we use

| Function | Used for | Needs user authorization |
|---|---|---|
| `createMarket(marketParams)` | Create a market; anyone may | - |
| `supplyCollateral(marketParams, assets, onBehalf, data)` | Supply collateral | No |
| `withdrawCollateral(marketParams, assets, onBehalf, receiver)` | Withdraw collateral | Yes |
| `borrow(marketParams, assets, shares, onBehalf, receiver)` | Borrow | Yes |
| `repay(marketParams, assets, shares, onBehalf, data)` | Repay | No |
| `supply`, `withdraw` | Lend stock to the short market | Withdraw: yes |
| `flashLoan(token, assets, data)` | Flash loan, no fee | - |
| `liquidate(marketParams, borrower, seizedAssets, repaidShares, data)` | Liquidation | - |
| `setAuthorization(authorized, isAuthorized)` | Grant or revoke router authorization | - |
| `setAuthorizationWithSig(authorization, signature)` | Same, with a signature | - |
| `position(id, user)`, `market(id)`, `idToMarketParams(id)` | Read | - |

`marketParams` contains `loanToken`, `collateralToken`, `oracle`, `irm`, `lltv`.

## Off-chain services

### KyberSwap, aggregator API

| Item | Value |
|---|---|
| Find a route | `GET https://aggregator-api.kyberswap.com/monad/api/v1/routes?tokenIn=…&tokenOut=…&amountIn=…` |
| Build the calldata | `POST https://aggregator-api.kyberswap.com/monad/api/v1/route/build` |
| Client ID | Request header `x-client-id` |

Finding a route has been used for measurements. Building the calldata, the request limits, and how to get a client ID are not verified (BE-04).

### Morpho, data API

`https://blue-api.morpho.org/graphql`, chain 143. The market ID is in the field `marketId` or `id`. The field `uniqueKey` is not recognized. Used for comparison and history, not as the main source. The main source is the network.

### Aurora Intents (NEAR Intents), 1Click API

| Item | Value |
|---|---|
| Token list | `GET https://1click.chaindefuser.com/v0/tokens` |
| Quote and deposit address | `POST https://1click.chaindefuser.com/v0/quote` |
| Status | `GET https://1click.chaindefuser.com/v0/status?depositAddress=…` |

Verified: Monad is supported as both origin and destination; its token list includes MON, USDT0, and USDC on Monad.

Not verified (BE-05): a real deposit from another network to Monad; its time and cost; the API key; the feature that runs automatic steps when funds arrive.

## Numbers measured on 13 October 2026

A starting point only. The backend measures again on a regular basis.

### Market depth (aggregator quotes)

| Stock | Exchange | Buy $100 | Buy $300 | Buy $1,000 | Buy $10,000 | Sell $300 | Sell $1,000 |
|---|---|---|---|---|---|---|---|
| aBIL | Monday Trade | +0.0% | +0.3% | +0.1% | +251% | -0.3% | -0.7% |
| aQQQ | Uniswap v4 | +0.3% | +2.0% | +3.4% | +35% | -1.9% | -5.1% |
| aHOOD | Uniswap v4 | +0.3% | +2.0% | +3.6% | +37% | -2.0% | -5.3% |
| aNVDA | Uniswap | +88% | - | +992% | very large | - | -92% |

The $300 column was measured at a different time from the other columns, so the numbers do not always line up (see aBIL). All of them are measured again in BE-04.

Of the 28 Anchored stocks checked, 24 have no route at all.

### DEX price compared to oracle price

| Stock | Oracle | DEX mid | Deviation |
|---|---|---|---|
| aBIL | $91.50 | $91.62 | +0.1% |
| aQQQ | $745.62 | $726.28 | -2.6% |
| aHOOD | $108.52 | $116.26 | +7.1% |

### Usage

| Item | Number |
|---|---|
| Anchored stock lending market on Morpho Monad | None yet |
| aNVDA in circulation | About 60 shares, roughly $13,600 |
| aNVDA transfers in 14 days | 41 times, 8.84 shares, between 16 addresses |

## About Anchored

| Item | Details |
|---|---|
| Number of tokens | About 80 stocks on Monad since 16 April 2026 |
| Target | Professional investors outside the United States and China |
| Identity check | For those who buy or swap directly with Anchored |
| Trading hours | 24 hours, 5 days a week |
| Dividends | Paid in USDC to the holder's wallet |
| Fees | 10 basis points when buying directly, 21 basis points when withdrawing |
| Control | Can block addresses (denylist) |
| Partner route | Needs a partner API key |

Unclear and must be asked of Anchored (X-12): what happens to dividends for stock held by Morpho, and whether their terms of use allow the tokens to be used in a lending venue.

## Coming up

| Who | What | Meaning for us |
|---|---|---|
| xStocks | Announced more than 1,100 stocks for Monad on 6 October 2026 | A source of new stocks and users. The design must be able to accept other issuers |
| Aave V4 | Proposal for a stock lending market on Monad, still at forum stage, with a $15 million incentive | A competitor for loans backed by stock collateral. Cannot borrow stock |
| HelloTrade | Leveraged stocks up to 40x, alpha stage | The closest competitor for long and short, uses futures contracts |
