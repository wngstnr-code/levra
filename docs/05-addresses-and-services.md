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

More Morpho contracts on Monad, taken from the address list in Morpho's own SDK (`morpho-org/sdks`, `packages/morpho-ts/src/addresses.ts`) and confirmed to have code on chain on 13 October 2026:

| Name | Address |
|---|---|
| Morpho vault factory (MetaMorpho v1.1) | `0x33f20973275B2F574488b18929cd7DCBf1AbF275` |
| Morpho Vault V2 factory | `0x8B2F922162FBb60A6a072cC784A2E4168fB0bb0c` |
| Morpho market adapter factory for Vault V2 | `0xa00666E86C7e2FA8d2c78d9481E687e098340180` |
| Morpho public allocator | `0x0A503aB026EFACBC0F7feE7795F34B80b5B9a662` |
| Wrapped MON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |

Common infrastructure, confirmed to have code at the usual addresses:

| Name | Address |
|---|---|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Safe 1.4.1 singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| Safe 1.4.1 L2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| Safe 1.4.1 proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |

Flash loan room: Morpho held about 10.5 million idle USDC on 13 October 2026.

These addresses are in `packages/shared/addresses.ts`. The vault type is decided: MetaMorpho v1.1 (D-24).

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

Verified on 13 October 2026 from aggregator routes for a $100 buy: all three pools pair the stock directly with USDC, and each route is a single hop (answers Q-16).

Still not verified (SC-04):

- No real swap has been sent on mainnet yet.

Verified on 13 October 2026: the aQQQ and aHOOD pools on Uniswap v4 have no hook. Each pool ID equals the hash of (stock token, USDC, fee 9000, tick spacing 90, hook address zero), and a pool ID commits to its hook. The fee of 9000 means each swap pays 0.90% to the pool, so a round trip pays 1.8% in pool fees before any price impact.

Verified on a local fork on 13 October 2026 (`contracts/script/e2e-long.sh`): calldata built by KyberSwap for our router executed from the router through the aQQQ pool in both directions. A long with 50 USDC of margin and 50 USDC borrowed bought 0.13588 aQQQ, and closing it returned 47.44 USDC, so the round trip cost about 2.6% of the $100 position, most of it price impact in the thin pool.

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
- The layout above matches Anchored's own documentation and was read successfully from the live contract on 13 October 2026.
- Every write emits `PriceUpdated(bytes32 indexed priceId, int256 price, int256 bestBid, int256 bestAsk, uint64 feedUpdateTimestamp, uint64 publishedAt, uint80 roundId, Session session)`, topic `0x2e2fc593...c07f`. Verified on 13 October 2026: the topic matches the signature, and logs filtered by `priceId` read back to at least 29 September 2026 through `rpc2.monad.xyz` in 10,000 block ranges. QQQ showed about 5 updates per 10,000 blocks. The oracle logger (BE-03) uses these logs, so its history starts weeks back instead of on the day it is started.

What Anchored's documentation says about the oracle (read on 13 October 2026, not independently verified unless marked):

| Topic | Details |
|---|---|
| `price` | Midpoint of best bid and best ask |
| Freshness | Use `feedUpdateTimestamp` (time of the source quote). `publishedAt` only says when the value was written on chain |
| Delay | The source quote can be about 15 minutes delayed |
| Heartbeat | 10 minutes by default |
| Suggested max age | 1,500 seconds (25 minutes) as a lower bound, before any product buffer |
| Write rules | `price`, `bestBid`, `bestAsk` must be positive, and `bestBid` cannot exceed `bestAsk` |
| `CLOSED` | The oracle carries the last price forward. `feedUpdateTimestamp` does not advance while closed |
| Other reads | `latestPriceNoOlderThan(priceId, maxAge)`, `latestPrices(priceIds)`, `latestPricesNoOlderThan(priceIds, maxAge)`, `isSupportedPriceId`, `hasPrice`, `description` |
| Read errors | `PriceIdNotFound`, `PriceNotAvailable`, `PriceTooOld` |
| Who writes | An operator role held by Anchored's backend |
| Same address on | Ethereum, Monad and Base |

Read from chain on 13 October 2026 (verified): the oracle is an upgradeable proxy. Implementation `0x8745912828473e9bef9d843ce8629bee3dcb9fec`, proxy admin `0xd9b74950dd514ed6086e4fa403d323338fedd5f0`.

Consequence for our design: `ISessionOracle.snapshot()` and the API expose `publishedAt`. Staleness should be judged on `feedUpdateTimestamp` while the market is open. This is an open decision (Q-22).

### Market sessions

From Anchored's documentation, and confirmed by two weeks of oracle writes (BE-03, see 04 and `docs/reports/oracle-2026-10-13.md`). Times are US Eastern Time.

| Session | Hours |
|---|---|
| Overnight | 8:00 PM to 4:00 AM |
| Pre-market | 4:00 AM to 9:30 AM |
| Regular | 9:30 AM to 4:00 PM |
| After-hours | 4:00 PM to 8:00 PM |

Trading runs from Sunday evening to Friday evening. It stops on weekends and US market holidays, and there may be pauses of a few minutes between sessions. One stock can also be halted during a corporate action such as a dividend or a stock split. So the weekly close is Friday 8:00 PM and the weekly open is Sunday 8:00 PM. The oracle logger (BE-03) still has to confirm what the oracle reports at each of these moments.

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

## Our deployment on Monad mainnet

Staging deployment of 13 October 2026 (SC-15). Verified by reading the contracts back from the chain. The binding source is `contracts/deployments/monad.json`, and `packages/shared` exports it as `monadDeployment`.

| Item | Value |
|---|---|
| `MarginRouter` | `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6` |
| `RiskManager` | `0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F` |
| `Lens` | `0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8` |
| `Liquidator` | `0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39` |
| Markets | QQQ, HOOD and BIL long, QQQ and HOOD short. IDs and oracles are in the deployment file |
| Owner and fee recipient | `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`, the deployer wallet, a single key until the handover of SC-55 |
| Keeper, calendar poster, oracle age poster | Not set |
| Block before the first transaction | 113046434 |
| Cost | 25 transactions, 18,325,235 gas charged, 1.87 MON at a gas price of 102 gwei |
| Source code verified | All nine contracts, exact match, on Sourcify (`sourcify.dev`) and on the Sourcify instance behind MonadVision (`sourcify-api-monad.blockvision.org`). Not submitted to Monadscan |

## Off-chain services

### KyberSwap, aggregator API

| Item | Value |
|---|---|
| Find a route | `GET https://aggregator-api.kyberswap.com/monad/api/v1/routes?tokenIn=…&tokenOut=…&amountIn=…` |
| Build the calldata | `POST https://aggregator-api.kyberswap.com/monad/api/v1/route/build` |
| Client ID | Request header `x-client-id` |

Verified on 13 October 2026:

- Finding a route works with any text as the client ID. We used `levra`.
- Building calldata works when `sender` and `recipient` are a contract that holds no funds. The request body was `routeSummary`, `sender`, `recipient` and `slippageTolerance` (in basis points). The answer has `routerAddress` (the router above), `data` (about 3,600 bytes for a one-hop route), `amountOut`, `gas` and `transactionValue`.

Also verified on a local fork on 13 October 2026:

- The built calldata executes from our router, for buying and for selling.
- The calldata carries its own minimum return, derived from the `slippageTolerance` sent when building. If the pool moved more than that, the swap reverts with "Return amount is not enough" before our own check. So the user's slippage setting must be passed to the build request.
- The build request is refused with "wallets invalid" for some addresses. The well-known first account of a local node is one of them.
- Verified on 13 October 2026 against the mainnet deployment: the build request accepts the mainnet router (`0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6`) as sender and recipient. Quotes for aQQQ, aHOOD and aBIL from the staging API built calldata for it.

Observed on 13 October 2026 (BE-04): a full depth run sends 33 route requests in 18 seconds, with a 300 ms pause between requests, and got no 429. KyberSwap does not publish the limit for an unregistered client ID, so the real limit is not verified. The client in `packages/kyber` reports a 429 as `RATE_LIMITED`, and the depth keeper counts them in its heartbeat. Still not verified: whether a registered client ID is needed for production use.

How the backend uses it (`packages/kyber`): `price()` asks for a route only; `quote()` also builds the calldata with our router as sender and recipient and the user's slippage; a route whose `routerAddress` is not the allowed swap target is refused. The DEX mid price is the average of a 10 USDC buy and a sale of the stock worth 10 USDC at the oracle price (D-36).

### Morpho, data API

`https://blue-api.morpho.org/graphql`, chain 143. The market ID is in the field `marketId` or `id`. The field `uniqueKey` is not recognized. Used for comparison and history, not as the main source. The main source is the network.

### Aurora Intents (NEAR Intents), 1Click API

| Item | Value |
|---|---|
| Token list | `GET https://1click.chaindefuser.com/v0/tokens` |
| Quote and deposit address | `POST https://1click.chaindefuser.com/v0/quote` |
| Status | `GET https://1click.chaindefuser.com/v0/status?depositAddress=…` |

Verified: Monad is supported as both origin and destination; its token list includes MON, USDT0, and USDC on Monad.

Price-only quotes on 13 October 2026 (`dry: true`, no API key, no funds moved):

| Route | Result | Estimated time |
|---|---|---|
| 50 USDC on Base to USDC on Monad | 49.889 USDC arrives (cost about 0.22%) | 37 seconds |
| 50 USDC on Arbitrum to USDC on Monad | 49.889 USDC arrives | 27 seconds |
| 50 USDC on Ethereum to USDC on Monad | 49.894 USDC arrives | 47 seconds |
| 1 USDC on Base to MON on Monad | 39.45 MON arrives | 39 seconds |

The last row shows the gas top-up of Q-10 is possible as a second small transfer. The service rejects requests from some HTTP clients, so the backend must send a normal user agent.

Still not verified (BE-05): a real deposit; whether an API key changes the fee; the feature that runs automatic steps when funds arrive.

## Numbers measured on 13 October 2026

A starting point only. The backend measures again on a regular basis.

### Market depth (aggregator quotes)

Measured by the depth keeper (BE-04) on 13 October 2026 at 12:29 UTC, all sizes in one run. Method: every size is one KyberSwap route quote; a sale of $X sells the stock worth $X at the oracle price; the price impact is the execution price against the DEX mid price (D-36), positive when worse for the trader. The keeper repeats the full table once a day and the mid price every 10 minutes; `pnpm --filter @levra/keeper report:depth` prints the latest run.

| Stock | Exchange | Buy $100 | Sell $100 | Buy $300 | Sell $300 | Buy $1,000 | Sell $1,000 | Buy $3,000 | Sell $3,000 | Buy $10,000 | Sell $10,000 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| aQQQ | Uniswap v4 | +1.3% | +1.2% | +1.9% | +1.9% | +4.4% | +4.2% | +11.4% | +10.1% | +36.0% | +26.1% |
| aHOOD | Uniswap v4 | +1.3% | +1.3% | +2.0% | +2.0% | +4.6% | +4.6% | +12.0% | +11.3% | +38.0% | +28.8% |
| aBIL | Monday Trade | +0.3% | +0.3% | +0.3% | +0.3% | +0.4% | +0.4% | +5.4% | +99.9% | +251.6% | +100.0% |

About 1% of every small trade on aQQQ and aHOOD is the 0.90% pool fee. The aBIL pool cannot absorb a sale of $3,000 or more: the route returns almost nothing.

The earlier one-time check of 28 Anchored stocks found 24 with no route at all. That was not measured again.

### DEX price compared to oracle price

Same run. DEX mid as in D-36.

| Stock | Oracle | DEX mid | Deviation |
|---|---|---|---|
| aBIL | $91.52 | $91.62 | +0.1% |
| aQQQ | $740.64 | $726.08 | -2.0% |
| aHOOD | $108.83 | $116.26 | +6.8% |

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
| Target | Professional and qualified investors outside the prohibited jurisdictions listed below |
| Identity check | For those who buy or swap directly with Anchored |
| Trading hours | 24 hours, 5 days a week |
| Dividends | Paid in USDC to the holder's wallet |
| Fees | 10 basis points when buying directly, 21 basis points when withdrawing |
| Control | Can block addresses (denylist) |
| Partner route | Needs a partner API key |

Unclear and must be asked of Anchored (X-12): what happens to dividends for stock held by Morpho, how stock splits are applied to the token and to the oracle price, and whether their terms of use allow the tokens to be used in a lending venue. The questions are drafted in `docs/outreach/anchored-questions.md`.

### Token behavior

Read from chain on 13 October 2026 (verified unless marked).

| Item | aQQQ, aHOOD, aBIL | USDC |
|---|---|---|
| Upgradeable | Yes. Each token is a beacon proxy. Beacon `0xfe296a422b74cb22bb3c507311f0663fd0d95dd8`, implementation `0x45ad0F7eb547B041cdf97e201566E194f36070f5`, beacon owner `0x0cB7D20d05eB07B6Aeed6654da58806a53672Db7` (beacon read for aQQQ only) | Yes. Proxy with implementation `0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d` and admin `0xc66bf3ef02d30e942bbab7f871d07b14d0ccc619` |
| `permit` | No. `DOMAIN_SEPARATOR()` and `nonces()` do not exist | Yes. `DOMAIN_SEPARATOR()` and `nonces()` answer, `version()` is 2 (answers Q-18) |
| Pause | No pause function on the token itself | Yes, a pauser role exists. Not paused when read |
| Blocking | The token points to a compliance contract, `0xF1aeD4E4816a91CebfCBd33378E38962abf73276`, which is itself upgradeable. It has a denylist (`addToDenylist`, `removeFromDenylist`, `isDenylisted`) and an approved list (`isApproved`) | Circle blacklist. Morpho was not blacklisted when read |
| Roles | Minter and burner roles. No function that moves or burns another holder's balance was found in the current implementation | Circle roles |
| Supply | aQQQ total supply was 16.53 tokens | - |

Compliance contract checks on 13 October 2026:

| Address | `isDenylisted` | `isApproved` | `requireNotBlocked` | `requireCompliant` |
|---|---|---|---|---|
| Morpho | false | false | passes | reverts with `UserNotApproved` |
| KyberSwap router | false | false | passes | reverts with `UserNotApproved` |
| A random address | false | false | passes | reverts with `UserNotApproved` |

Reading: there are two levels. "Not blocked" is true for everyone who is not on the denylist. "Compliant" is true only for approved addresses, which fits identity-checked accounts. Since exchange pools and ordinary wallets hold and trade the tokens, plain transfers most likely need only "not blocked". On a local fork on 13 October 2026, aQQQ bought from the exchange was supplied to Morpho as collateral and withdrawn again, so a plain transfer to and from Morpho is allowed today.

What this means for us:

- Anchored can block the Morpho address or our router with one call, and can change token and compliance logic by upgrading. Collateral could then be stuck. This is threat T-08 and cannot be closed with code.
- Stock tokens have no `permit`, so lending stock in Earn needs a normal `approve` transaction first. The one-confirmation path with signatures (D-20) works for USDC only.

### Who may hold Anchored tokens

From Anchored's eligibility page (read on 13 October 2026). The products are for professional and qualified investors. Residents, citizens and entities of these places may not subscribe, buy or redeem: Afghanistan, Algeria, Belarus, Canada, China (not Hong Kong), Cuba, North Korea, Eritrea, Iran, Libya, Myanmar, Morocco, Nepal, Russia, Somalia, South Sudan, Sudan, Syria, the sanctioned regions of Ukraine, the United States, and Venezuela. US persons under Regulation S are excluded wherever they are. Sanctioned persons are excluded everywhere.

Our geo-blocking list is an open decision (Q-24). Earlier docs said "outside the United States and China". The real list is longer.

## Other services checked

| Service | Finding | Status |
|---|---|---|
| Envio | Its supported networks page lists Monad mainnet, chain 143, with HyperSync at `https://143.hypersync.xyz`. Whether an API token is required was not found | From documentation. Not run (BE-06) |
| Privy | The embedded wallet is a normal key wallet by default (an HD wallet). It supports `signTypedData` and private key export. Smart wallets are an optional layer on top | From documentation. Run on 13 October 2026: embedded wallet creation by email and passkey, and export of its recovery phrase. `signTypedData` not run (FE-02, FE-11) |
| Vercel | Hosts `apps/web` from Wangsit's account (root directory `apps/web`, Node.js 24.x), at `https://levra-mon.vercel.app`. An import from a Hobby account that does not own the private repo fails at "Preparing Git Repository". Each origin the app runs on must be listed in the Privy allowed domains, exactly with its scheme | Verified on 13 October 2026: the site serves `/markets`, sign-in works, and each PR gets a preview deployment (FE-01) |
| Local fork | Anvil 1.8.3 forks Monad through the public RPC. Reads and an impersonated `approve` work | Verified for those calls only (SC-02) |

## Name and domains

Checked by DNS lookup on 13 October 2026. A domain with no name servers may be free, but only a registrar can confirm.

| Name | State |
|---|---|
| `levra.com`, `levra.io`, `levra.xyz`, `levra.app`, `levra.trade`, `getlevra.com` | In use (they resolve) |
| `levra.fi`, `levra.finance`, `levra.markets` | No name servers found |
| GitHub user `levra` | Taken since 2018 |
| GitHub names `levra-finance`, `levrafi` | Not found, so likely free |

## Coming up

| Who | What | Meaning for us |
|---|---|---|
| xStocks | Announced more than 1,100 stocks for Monad on 6 October 2026 | A source of new stocks and users. The design must be able to accept other issuers |
| Aave V4 | Proposal for a stock lending market on Monad, still at forum stage, with a $15 million incentive | A competitor for loans backed by stock collateral. Cannot borrow stock |
| HelloTrade | Leveraged stocks up to 40x, alpha stage | The closest competitor for long and short, uses futures contracts |
