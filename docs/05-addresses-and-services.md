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
| Morpho public allocator (BluePublicAllocator, for Vault V2 vaults: `vaultV2Factory()` returns the Vault V2 factory, checked on 19 November 2026. It does not serve our MetaMorpho vault) | `0x0A503aB026EFACBC0F7feE7795F34B80b5B9a662` |
| Wrapped MON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |

Common infrastructure, confirmed to have code at the usual addresses:

| Name | Address |
|---|---|
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Safe 1.4.1 singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` |
| Safe 1.4.1 L2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| Safe 1.4.1 proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| Safe app and transaction service | Monad mainnet is supported: `safe-config.safe.global` lists chain 143 with the transaction service `api.safe.global/tx-service/monad` (verified 13 October 2026) |
| Team multisig (`Levra Team`) | `0x5e40f4Be2dEF4900Aa7BBe0eb8B7ba733c1Cf069`, the same address on Base, X Layer and Monad, created on 20 November 2026 in the Safe app and activated on all three by Wangsit. Verified on chain on 20 November 2026 on all three: `getOwners()` = Wangsit `0x49d8ccbbf1c68f4133b860eA8d1FE76f6AD13488`, Dharu `0x5c4Face99DA96A1C8E10AbAcE75851f32C427A68`, Nabil `0xbf8a9a4F0f1547D109088C229DE55B3216658185`; `getThreshold()` = 2; `VERSION()` = 1.5.0 with singleton `0xEdd160fEBBD92E350D4D398fb636302fccd67C7e`; no modules, no guard, nonce 0. Each signer confirmed their own address. Safe supports all three chains (verified on 20 November 2026: `safe-config.safe.global` lists 8453, 196 and 143 with a transaction service). First multisig transaction on Base, signed by Wangsit and Nabil and executed by Wangsit on 20 November 2026: `0x49ce3befe4d95ff9371fd5d1601984391baa2ffd3c5b87fa7b198edd5c3b6926` (block 59857959, status success, Safe nonce now 1). First transaction on X Layer, signed by Wangsit and Dharu and executed by Wangsit on 20 November 2026: `0x00415502890dde867aee07a7a0289ae05fcc8498b45906a111aa93be4c5f78f2` (Safe nonce now 1). All three keys have now signed |
| Domain | `levra.finance`, registered at Hostinger on 20 November 2026, expires 20 November 2027, transfer lock on (read from the registry RDAP). DNS on Cloudflare, free plan, account `levrafinance` Gmail; name servers `clarissa.ns.cloudflare.com` and `nolan.ns.cloudflare.com`, verified on 20 November 2026. Records: `app` (CNAME to Vercel, DNS only, verified on 20 November 2026: Vercel shows Valid Configuration and `https://app.levra.finance` answers 200 on `/markets`). Root and `www` wait for the landing site, `api` for the VPS. No email on the domain for now (the team chose not to set up Google Workspace on 20 November 2026) |

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
| USDC vault | `0xfB99A7E3f5571baA363d67F7823bb354cfd95447`, `Levra USDC` (`lvUSDC`), MetaMorpho v1.1 from Morpho's factory. Caps: 10,000 USDC for QQQ, 5,000 for HOOD, 20,000 for BIL. Fee 10%, timelock 1 day. Curator and guardian not set. Cost 0.73 MON in 11 transactions. A deposit was charged 674,482 gas and a full redeem 517,582 gas |
| Markets | QQQ, HOOD and BIL long, QQQ and HOOD short. IDs and oracles are in the deployment file |
| Owner and fee recipient | `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`, the deployer wallet, a single key until the handover of SC-55 |
| Deployer for new deployments | `0x7C7b6639d9cb9Eb691de0Eb90146ff77cde947D0`, a new wallet used only to deploy (Base, X Layer, the Monad router of SC-87). Read on 20 November 2026: 0.0029971 ETH on Base, 0.019988 OKB on X Layer, 6.5778 MON on Monad, nonce 0 on all three. It does not own the live Monad contracts; those stay with `0x7029...1855` until they move to the multisig |
| Keeper, calendar poster, oracle age poster (since 21 November 2026) | New keys made on the VPS by Dharu (BE-55), files only on the server. Router keeper `0x469ab4F20dcDcD470b89A829783B5bbd5c64f474`, `Liquidator` keeper `0xE36EafE2cC96F256B80E7952DFFBe916f0d64a6A`, calendar poster `0xd166D46a4e61daC99e87472B76423A9C379274Fb`, oracle age poster `0xaec389DfC7D6F5CaB30e7D761206D989f7F6ed19`. Granted by Wangsit with `make set-roles-monad` and the two old keepers removed, all on 21 November 2026 (hashes in PROGRESS). The MON of the old wallets was moved to the new ones by Dharu | Verified onchain on 21 November 2026: `isKeeper` true for the new keepers and false for the old ones, both posters read back, balances moved |
| Keeper, calendar poster, oracle age poster (14 October to 21 November 2026, replaced) | Keys made on 14 October 2026 with the BE-55 script and stored only on Railway's keeper service. Granted by Wangsit on 14 October 2026 with `make set-roles-monad` in blocks 113204418 to 113204447; verified by reading `isKeeper` on the router and the `Liquidator` and `calendarPoster()` and `oracleAgePoster()` on `RiskManager`. Funded by Wangsit on 14 October 2026 (10 MON each, about 20 MON for the calendar poster); verified by balance, and every keeper reports healthy on `/v1/status`. First transaction: `setNextCloseAt` by the calendar poster, `0xc2047d91042f4a88ed234c923810897fff91241af3a86c452ad2cd048c241199`. Oracle age poster `0x33B03c6e569e06938D59F1232ef5070646F0146d`, calendar poster `0x745356C469FcE1372B4C2259332f5251130d4a5b`, router keeper (protector) `0x3BcB6A6c1d21d229bF8d5Ea5524b3d1aEe3b841e`, `Liquidator` keeper `0x22ea6605a7D5246b1F05831632DC8172125A5C18`. `make set-roles-monad` grants them |
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

Observed on 13 October 2026 (BE-04): a full depth run sends 33 route requests in 18 seconds, with a 300 ms pause between requests, and got no 429. The client (now in `packages/swap`, BE-96) reports a 429 as `RATE_LIMITED`, and the depth keeper counts them in its heartbeat.

From KyberSwap's documentation (read on 14 October 2026, "Rate Limits & Client ID"): the public aggregator API allows 3 requests per second. Client ID whitelisting is no longer offered for the aggregator; higher limits come with an API key, sent as `X-Api-Key` to the gateway at `https://api.kyberswap.com/swap/` (`GET /routes`, `POST /route/build`), requested from business@kyber.network. Not stated: whether the limit counts per IP or per client ID, the gateway's limits, and the gateway path for Monad. Not verified by us.

Observed on 14 October 2026: from Railway, quotes got 429 most of the time (Nabil, about 2 of 3 tries), while 6 quick route requests from Dharu's machine all passed. One open quote sends a route request and two mid price probes at once, then a build, so a single quote already reaches the 3 per second limit. Since then the client starts requests at least 350 ms apart and retries once, 1 second after a 429; the API budget is 12 calls at once plus 60 a minute (BE-51, initial proposal). `KYBER_API_KEY` sends the key when we have one; the gateway path for Monad is not verified.

How the backend uses it (`packages/swap`, before BE-96 `packages/kyber`): `price()` asks for a route only; `quote()` also builds the calldata with our router as sender and recipient and the user's slippage; a route whose `routerAddress` is not the allowed swap target is refused. The DEX mid price is the average of a 10 USDC buy and a sale of the stock worth 10 USDC at the oracle price (D-36).

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

Verified on 14 October 2026 (no funds moved): without a partner token every quote carries an app fee of 20 bps (0.2%) to a 1Click recipient, on top of the route cost; the 50 USDC rows above include it. A quote with `dry: false` returns a deposit address (EVM style for Base), `deadline` and `timeWhenInactive` about 72 hours after the deadline we asked for, `refundFee` and `withdrawFee`; its status is `PENDING_DEPOSIT` until funds arrive. Only `PENDING_DEPOSIT` has been seen so far. The backend also handles `INCOMPLETE_DEPOSIT`, `KNOWN_DEPOSIT_TX`, `PROCESSING`, `SUCCESS`, `REFUNDED` and `FAILED` from 1Click's documentation; not verified until a real transfer. One deposit address delivers one token, so the MON top-up is a second transfer (D-40).

Still not verified (BE-05): a real deposit; whether a partner token removes the 0.2% fee; the feature that runs automatic steps when funds arrive.

## Numbers measured on 13 October 2026

A starting point only. The backend measures again on a regular basis.

### First real run on mainnet

Measured on 13 October 2026 in the pre-market session, with the deployer wallet and tiny positions (SC-15). Verified from the receipts. One sample per market, so these are not averages.

| Market | Position | Margin in | Returned after a full close | Cost of the round trip |
|---|---|---|---|---|
| QQQ long | 3 USDC of stock | 1.500000 | 1.443299 | 0.0567 USDC, 1.89% of the position |
| HOOD long | 3 USDC of stock | 1.500000 | 1.443299 | 0.0567 USDC, 1.89% of the position |
| BIL long | 3 USDC of stock | 1.500000 | 1.479045 | 0.0210 USDC, 0.70% of the position |
| QQQ short | 0.00135 aQQQ, about 1 USDC | 1.500000 | 1.430726 plus 0.000069 aQQQ | About 0.018 USDC after counting the leftover stock |
| HOOD short | 0.00921 aHOOD, about 1 USDC | 1.500000 | 1.430223 plus 0.000421 aHOOD | About 0.024 USDC after counting the leftover stock |

The cost includes our 0.10% fee, which went to the fee recipient, the same wallet in this run. A short of 1 USDC at the oracle price sold for 0.97 on QQQ and 1.06 on HOOD, so aHOOD traded above its oracle price at that moment.

| Gas | Value |
|---|---|
| Open, charged | 1.64 to 1.78 million gas, 0.17 to 0.19 MON at 102 gwei |
| Close, charged | 1.49 to 1.60 million gas, 0.15 to 0.16 MON at 102 gwei |
| Whole run, 30 transactions | 2.20 MON |

Monad charges the gas limit, and the scripts send the estimate plus 50%, so the charged amount is 1.5 times the estimate. On a fork, a close sent with the bare estimate ran out of gas.

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
| Railway | Hosted the backend from 14 October to 20 November 2026 (D-41, replaced by D-94): project `levra` with services `api`, `indexer`, `keeper` and `Postgres`, built from `main`. The old API address `https://api-production-c154.up.railway.app` no longer serves the API | Verified on 14 October 2026 that all three services ran. Checked on 20 November 2026: `/v1/health` answers 404 |
| VPS | Planned host of the backend (D-94): Docker Compose with Postgres, one API, one indexer and one keeper per chain, and Caddy for HTTPS. Setup in `docs/hosting.md` | Server running at netcup since 20 November 2026: VPS 1000 G12.5, 4 vCore, 8 GB RAM, 128 GB disk, Nürnberg (Germany), monthly. IP addresses kept out of this public repo. Backend not deployed yet. BE-90 |
| Telegram | Alert bot `@levra_alerts_bot` (BE-33, BE-50). Its token was only on Railway's keeper service (`TELEGRAM_BOT_TOKEN`) until 20 November 2026 and becomes a secret file of the keeper on the VPS (BE-90); the username goes on the api (`TELEGRAM_BOT_USERNAME`). Team alerts go to the "Levra Team" group (`TEAM_TELEGRAM_CHAT_ID`). It is a basic group: if it is ever upgraded to a supergroup, its chat id changes and the variable must be updated | Verified on 14 October 2026: `getMe` answers for the token, a test message reached the group, and the keeper runs `alerts` and `monitor` |
| Vercel | Hosts `apps/web` from Wangsit's account (root directory `apps/web`, Node.js 24.x), at `https://app.levra.finance` (production domain since 20 November 2026; Cloudflare CNAME `app` to Vercel, DNS only, not proxied, as Vercel asks) The old `levra-mon.vercel.app` domain was removed on 20 November 2026 and answers 404. An import from a Hobby account that does not own the private repo fails at "Preparing Git Repository". Each origin the app runs on must be listed in the Privy allowed domains, exactly with its scheme | Verified on 13 October 2026: the site serves `/markets`, sign-in works, and each PR gets a preview deployment (FE-01) |
| Vercel Web Analytics | Counts page views without cookies. The app also sends five funnel steps with no amounts or addresses (`apps/web/lib/metrics.ts`): `sign_in_opened`, `confirm_opened`, `position_opened`, `deposit_address_shown`, `supply_confirmed`. Custom events need a paid Vercel plan; on Hobby only page views are kept | From documentation. Not checked on the dashboard (FE-54) |
| Local fork | Anvil 1.8.3 forks Monad through the public RPC. Reads and an impersonated `approve` work | Verified for those calls only (SC-02) |

## Base (chain 8453)

Read from the Base RPC (`https://mainnet.base.org`, block 59495063), the Morpho API, Sourcify, Morpho Docs and Base Docs on 19 November 2026, around 11:00 to 12:00 UTC (SC-70). Every address below has code on Base mainnet at that block. "Verified onchain" means a call to the contract returned the stated value. The transfer policy per token is SC-71 and is not covered here.

### Infrastructure

| Contract | Address | Status |
|---|---|---|
| Morpho (Blue core) | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` | Verified onchain. Same address as on Ethereum |
| AdaptiveCurveIrm | `0x46415998764C29aB2a25CbeA6254146D50D22687` | Verified onchain: `MORPHO()` is the core above. Every stock market below uses it |
| MorphoChainlinkOracleV2 factory | `0x2DC205F24BCb6B311E5cdf0745B0741648Aebd3d` | Code present. Address from Morpho Docs |
| MetaMorpho factory v1.1 | `0xFf62A7c278C62eD665133147129245053Bbf5918` | Verified onchain: `MORPHO()` is the core above. Address from Morpho Docs. The one to use for Levra vaults (as D-24 on Monad) |
| MetaMorpho factory v1.0 (old) | `0xA9c3D3a366466Fa809d1Ae982Fb2c46E5fC41101` | Verified onchain: `MORPHO()` is the core above. Do not use |
| Vault V2 factory | `0x4501125508079A99ebBebCE205DeC9593C2b5857` | Code present. Address from a summary of Morpho Docs, not read verbatim |
| PublicAllocator (for MetaMorpho vaults) | `0xA090dD1a701408Df1d4d0B85b716c87565f90467` | Verified onchain: `MORPHO()` is the core above, Sourcify name `PublicAllocator` |
| BluePublicAllocator (for Vault V2) | `0xAED282B8aD9257BB1272e93aE63A32A53621e412` | Sourcify name `BluePublicAllocator`, reads `vaultV2Factory()`. Not for MetaMorpho vaults |
| MorphoRegistry | `0x5C2531Cbd2cf112Cf687da3Cd536708aDd7DB10a` | Code present. Address from Morpho Docs |
| USDC (native, Circle) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Verified onchain: `symbol()` is "USDC". Every stock market below lends it |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Code present (canonical address) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Code present (canonical address) |
| Safe 1.4.1 singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | Verified onchain: `VERSION()` is "1.4.1" |
| Safe 1.4.1 L2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | Code present (canonical address) |
| Safe 1.4.1 proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | Code present (canonical address) |
| Coinbase oracle registry | `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD` | Sourcify name `OracleRegistry`. `getOracleParams(address token)` returns `(uint256 multiplier, bool paused)`, keyed by the stock token, not by the feed. Pausing is `setOraclePaused` behind `PAUSER_ROLE`. Verified onchain for the 8 tokens below. Address from Base Docs |
| B20 policy registry | `0x8453000000000000000000000000000000000002` | Precompile (code size 1 byte). Address from `api.coinbase.com/v1/tokenized-stocks/chains`. `policyExists` and `isAuthorized` are read in SC-71 |
| Stock token factory (`B20AssetFactory`) | `0x4bA3E29E254F25E94E61C4c9d67b37027331534D` | Verified onchain: ERC-1967 proxy to `0xbbcb88b1e706624d7fb631b0b2557a173ef028ca` (Sourcify name `B20AssetFactory`), deployed at block 48459816. `transferPolicyId()` is 5, `SECURITY_TOKEN_DECIMALS()` is 8, `tokenSupplyManager()` is the manager below. Each new token emits `SecurityTokenDeployed` |
| Token supply manager | `0xD1Ca4dAcdf3231011D175351f1f02D15C7c5664C` | Verified onchain: ERC-1967 proxy to `0x3f27d252526470a04d6222252e37b84580a4c6e3` (Sourcify name `TokenSupplyManager`) |
| 1inch AggregationRouterV6 | `0x111111125421cA6dc452d289314280a0f8842A65` | Sourcify name `AggregationRouterV6`. Same address as on other chains. Swap target on Base (D-72) |
| KyberSwap MetaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | Sourcify name `MetaAggregationRouterV2`, the same address as on Monad. Seen routing into the Aero NVDAc pool on 19 November 2026. Swap target on Base (D-80) |
| Aero Slipstream V3 CL factory | `0x9CB220581b91b0C83223012FE69688b92aD07a76` | Listed as `clFactory` in Dromos Labs' official deployment file (`github.com/Dromos-Labs/metadex-slipstream-public`, `deployment-addresses/cl-base.json`; the org is linked from aero.xyz). Aero is the merger of Aerodrome and Velodrome, live since 21 October 2026 (press). Holds the deepest stock pools, see below |
| Aero SwapRouter | `0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418` | `swapRouter` in the same file. Verified onchain: `factory()` is the factory above, Sourcify name `SwapRouter`. Swap target on Base (D-80) |
| Aero MetaQuoter | `0x1dDfeC5058180C207F55BB77D95AcDd0d8227868` | `metaquoter` in the same file. Code present. Quotes one pool with `quoteExactInputSingleV3` (BE-96, see "Swap providers in the backend") |
| Aero Voter | `0x382409fad8503FbCdbB27A4211551fa03e884078` | `voter` in the same file; the factory's `voter()` returns it |
| Aerodrome (before the merger) | v2 PoolFactory `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` and Router `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`; Slipstream factories `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` (SwapRouter `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`) and `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` (SwapRouter `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F`) | From the aerodrome-finance GitHub READMEs. Their stock pools are empty (v2: AAPLc, NVDAc and SPCXc pools hold under $30) or much smaller than Aero's. Not used |

The last three addresses come from `api.coinbase.com/v1/tokenized-stocks/chains`. Our network blocks that host, so it was read over another connection on 19 November 2026.

### Stock tokens and Morpho long markets

All stock tokens are B20 precompiles: the address starts with `0xb2000`, its code size is 1 byte, and `symbol()` and `decimals()` answer. All have 8 decimals. Each "listed" market below is shown by Morpho's own app and lends USDC with the AdaptiveCurveIrm. Supply and borrow in USD are from the Morpho API and change daily.

| Stock | Token | Market ID (listed) | LLTV | Morpho oracle | Supply / borrow (USD) |
|---|---|---|---|---|---|
| AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` | `0xae1a30486234bf7e7ac166c7c03d9bc5f2cd8a39be2c48e73c665ac7148c3c28` | 62.5% | `0xEcC5c9bf18CB2CfC94C2f7EFf8BDd5837A60AB0e` | 16,148 / 14,653 |
| AMZNc | `0xb200000000000000000000d9192b6B456483C2E8` | `0xcca091ada0a486dd74743ab5f1b1b972adefaad357e2634fd7362a0d798dcd42` | 62.5% | `0x52cE337EC871EC8f3490285b70A42aAb07814769` | 27 / 25 |
| GOOGLc | `0xb2000000000000000000002D0BA3164cc74f58B7` | `0xa3913d896b7e9c0e0a84f1be27d376cf2065616101cb7c44674af8a154e684cc` | 77% | `0x24DC11055aa5b2C5692E4B77d7285c4f0fd9Cf99` | 5,271 / 4,773 |
| GOOGLc | same | `0x0cc78b1f4993015116e90626a18a1ba0e1ca73d0b75781b231d02fa5536e62a5` | 62.5% | same | 0 / 0 |
| METAc | `0xb2000000000000000000008bC8786B856E61707C` | `0x44b343b5087c0bd34207cb5c199f12030777bf6b8c0a128438246f1212f37ca5` | 62.5% | `0x4752B27dFc1931eb9a5DFEFC7FBC9d0af9020dC7` | 11,915 / 10,959 |
| MSFTc | `0xB200000000000000000000Ab99cFa739E253872B` | `0x4f9329a87a70e722cdab07b3647ef705671b25079d4f3bae559be5cfe12a7318` | 62.5% | `0x5a4CEB3240d50A16a8BBBBc0F72C53018B8E38be` | 37 / 25 |
| NVDAc | `0xb20000000000000000000078ee7ce2fE4908108C` | `0xb4b42dd66cef25614b94510a910d54b2c148e7621d22b4271566724beda63d13` | 62.5% | `0x4F698C04d01d9CebCDd9494c189aBdD6C5453f84` | 1,593 / 1,455 |
| SPCXc | `0xb2000000000000000000007b9fcbd005511aCBd5` | `0xce983b9ee6344e16ebbcc66812f23caafc63ae83fcc14fa29b66c7e69e9cecf6` | 62.5% | `0x9079857a2b5FFfC3d87052b11b866a185B4A6483` | 6,255 / 5,671 |
| TSLAc | `0xb2000000000000000000001e800a7f5189430cD0` | `0xc819df1685193012fc1d189e4ae22f6658442805f121303aebb04c81bd6d55d5` | 62.5% | `0xFDD26bC94502a281f333e9593501d9A3C5a9905c` | 0 / 0 |

Morpho also has unlisted markets for these tokens (other oracles, LLTV up to 98%). They hold almost nothing and are ignored. The listed markets that hold real supply are about 90% borrowed, and the TSLAc market and the 62.5% GOOGLc market are empty, so a new long finds little USDC until a vault (ours or others) supplies more.

### Stock liquidity (BE-71)

Pools against USDC from GeckoTerminal on 19 November 2026 around 15:00 UTC, largest first. "Aero" is the Aero Slipstream V3 factory above; "Aerodrome 3" is the pre-merger factory `0xf8f2...`. Reserves and volume change daily.

| Stock | Largest pool (Aero) | Reserve | 24 h volume | Next pools |
|---|---|---|---|---|
| NVDAc | `0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec`, dynamic fee (0.146% at the read) | $1.80M | $14.6M | Aerodrome 3 $368k, Uniswap v3 $92k, Uniswap v4 $53k |
| AMZNc | `0x532e0f46...` | $1.40M | $8.9M | Aerodrome 3 $47k, Uniswap v4 $29k |
| GOOGLc | `0x16c70f04...` | $1.36M | $8.3M | Aerodrome 3 $213k, Uniswap v3 $43k |
| METAc | `0xd072410f...` | $876k | $6.8M | Aerodrome 3 $103k, Uniswap v4 $27k |
| AAPLc | `0xf5fcb9cd...` | $340k | $3.5M | Aerodrome 3 $58k, Uniswap v4 $27k |
| MSFTc | `0x2740c0fa...` | $318k | $3.5M | Uniswap v4 $27k, Aerodrome 3 $16k |
| SPCXc, TSLAc | not read (rate limited) | | | |

Reserve is the whole pool, not the depth near the price.

### Swap cost through 1inch (BE-71)

1inch Swap API v6.0 (`api.1inch.dev`, chain 8453), 19 November 2026 around 15:30 UTC, a Thursday in US regular hours. The cost is the price paid against the Chainlink feed price, in basis points: positive means paying more than the oracle when buying, or getting less when selling. It mixes the gap between the DEX and the oracle with price impact.

| Stock | Buy $100 | Buy $1,000 | Buy $10,000 | Sell $1,000 | Main venues |
|---|---|---|---|---|---|
| AAPLc | 32 | 37 | 38 | 27 | Metric |
| AMZNc | -2 | -1 | 2 | 66 | Metric |
| GOOGLc | -8 | -7 | -6 | 71 | Metric |
| METAc | 57 | 58 | 58 | 8 | Metric |
| MSFTc | 52 | 53 | 70 | 37 | Aero CL |
| NVDAc | 42 | 50 | 48 | 20 | Metric, Baibai |
| SPCXc | 71 | 72 | 67 | -1 | Metric |
| TSLAc | 54 | 57 | 84 | 38 | Aerodrome Slipstream, Aero CL |

- 1inch routes all 8 stocks. A $10,000 trade costs about the same as $100 for six of them, so the depth is well above our first position sizes. MSFTc and TSLAc rise by 17 and 30 bps at $10,000.
- Built swaps (`/swap`, sender and receiver a contract, `disableEstimate`) for $1,000 of NVDAc, TSLAc and MSFTc target the 1inch router `0x1111...2A65`. Run with `eth_simulateV1` on the live node from Morpho's address (a contract holding USDC, standing for our router), each succeeds and delivers exactly the quoted amount, using 446,000 to 565,000 gas.
- The API refuses requests whose User-Agent looks like a script library (Cloudflare error 1010). Send a plain client name.
- Verified by quote and simulation on this date only. Prices and routes change by the minute.

### Full long and short on Base, simulated (SC-75)

`make base-live-e2e` on 19 November 2026 at block 59581480 (NVDA oracle $152.98): our router, risk manager and two `ChainlinkSessionOracle` were deployed inside an `eth_simulateV1` run on the live node, with an NVDAc long and short market and lent liquidity. A user with 1,000 USDC then:

| Step | Route | Result | Gas |
|---|---|---|---|
| Open long, $100 margin and $100 borrowed | 1inch | 1.30121303 NVDAc collateral | 813,071 |
| Open short, $50 of NVDAc | KyberSwap | 0.3268353 NVDAc debt | 894,490 |
| Close long in full | Aero SwapRouter | Debt and collateral 0 | 619,089 |
| Close short in full | 1inch | Debt and collateral 0 | 716,225 |

The router ended with 0 USDC and 0 NVDAc. The user ended with 997.18 USDC and 0.00856 NVDAc (the buy back surplus), so both round trips cost about $1.50 in fees, spread and interest. Verified by simulation only; nothing was sent.

On Monad (chain 143), 1inch quotes aQQQ and aHOOD through the same Uniswap v4 pools KyberSwap uses, and returns `INSUFFICIENT_LIQUIDITY` for aBIL. So Monad keeps KyberSwap (D-81).

### Swap providers in the backend (BE-96)

`packages/swap` holds the three Base providers behind one interface (D-104):

- KyberSwap: `aggregator-api.kyberswap.com/base/api/v1`, the same `/routes` and `/route/build` calls as on Monad.
- 1inch: Swap API v6.0 `/quote` for prices and `/swap` for calldata, with the bearer key, a plain User-Agent, `disableEstimate=true` and the slippage in percent. One request per 1.1 s by default (initial proposal, our plan's limit is not yet confirmed).
- Aero: the factory's `getPool(tokenA, tokenB, tickSpacing)` for each enabled tick spacing (1, 10, 50, 100, 150, 200, 250, from the factory's constructor), then the MetaQuoter's `quoteExactInputSingleV3(pool, tokenIn, amountIn, sqrtPriceLimitX96)` per pool through `eth_call` (it simulates the swap and reverts with the result; source `contracts/periphery/lens/Metaquoter.sol` in the Dromos Labs repo). The pool that gives the most is used in `exactInputSingle` on the SwapRouter.

Live check on 22 November 2026 around 17:45 UTC (a Saturday, so the stock markets were closed): 100 USDC into each of the 8 stocks, sender a fixed address. KyberSwap and Aero both answered for all 8, within 0.05% of each other (for example NVDAc 0.76767 and 0.76755). 1inch was not called, its key is on the VPS only. Verified: quotes and calldata build. Not verified yet: that the built calldata delivers the quote (`eth_simulateV1`, part of BE-96's "Done when").

### Transfer policy and pause (SC-71)

Read and simulated against the live Base node on 19 November 2026 at 13:20 UTC (block 59520298). The check is `packages/shared/b20-policy.live.test.ts`; run it with `BASE_RPC_URL` set.

| Item | Finding | Status |
|---|---|---|
| Policy per scope | All 8 tokens use policy 5 for `TRANSFER_SENDER_POLICY`, `TRANSFER_RECEIVER_POLICY` and `TRANSFER_EXECUTOR_POLICY` (read with `policyId(bytes32)` on the token). It is also the default the stock token factory gives new tokens (`transferPolicyId()` is 5) | Verified onchain |
| Policy 5 | Exists. Authorizes Morpho, the 1inch, KyberSwap and Aero routers (D-80; the pre-merger Aerodrome routers too), the zero address and fresh addresses that never held anything. So it acts as a blocklist: everyone may send, receive and pull except listed accounts. The list itself cannot be read without the registry's event history | Verified onchain |
| Policy admin | `policyAdmin(5)` is `0xEC0F05C174e54FBf0Fe16ad930a8AFEbCe612812`, an address with no code, so one key can add Morpho, our router or a user to the blocklist at once, for all 8 stocks | Verified onchain. Whose key it is is not verified |
| Recheck before SC-76 | 21 November 2026 at block 60365004: `b20-policy.live.test.ts` passes again (32 of 32), `policyAdmin(5)` is unchanged, and policy 5 also authorizes the deployer `0x7C7b...47D0` and the team Safe `0x5e40...f069`, which send the seed stock. The same day `make base-live-e2e` moved NVDAc through freshly deployed router and liquidator code, so new contract addresses pass the policy | Verified onchain |
| Executor check | `transferFrom` checks the caller under the executor scope. `approve` is not policy gated (Base Docs) | From Base Docs. The simulation below covers it |
| Pause | `isPaused` is false for transfer, mint, burn and seize on all 8 tokens. Pausing is per feature. The Coinbase oracle registry also has its own per token pause flag | Verified onchain at the read |
| Moves through Morpho and the routers | `eth_simulateV1` on the live node, per token: Morpho sends 1 base unit to a fresh address; the fresh address approves each swap router, the router pulls it with `transferFrom` and sends it back; then Morpho pulls it back with `transferFrom`. Every call succeeds. A pull without approval fails, so the simulation enforces the token rules | Verified by simulation, nothing sent |
| Local forks | Anvil 1.8.3 cannot run B20 tokens: the code is the single byte `0xef` and every call ends in `OpcodeNotFound`, with `--network optimism` too. Foundry fork tests cannot move Base stocks | Verified locally |

Result for Q-36: no listed stock blocks Morpho, the swap routers or a fresh contract today, so all 8 stay listed. This can change at any time, by one key, with no delay.

### Price feeds

Each Morpho oracle above is a ChainlinkOracleV2 that uses only `BASE_FEED_1`, with no second feed, no quote feed and no vault. That feed is the Coinbase feed named in Base Docs.

| Stock | Feed proxy (`BASE_FEED_1`) | Description | Answer at the read (8 decimals) | Multiplier in the registry |
|---|---|---|---|---|
| AAPLc | `0x787f13dEa48Db0897CbCDD985de77809D837F988` | Coinbase AAPL | 354.72 | 1.000500 |
| AMZNc | `0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295` | Coinbase AMZN | 274.06 | 1.000000 |
| GOOGLc | `0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2` | Coinbase GOOGL | 293.94 | 1.000377 |
| METAc | `0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D` | Coinbase META | 624.87 | 1.000314 |
| MSFTc | `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` | Coinbase MSFT | 513.78 | 1.000000 |
| NVDAc | `0x04689a41629776563E6822F76f2e57D148d28513` | Coinbase NVDA | 154.54 | 1.000538 |
| SPCXc | `0x6A634B235903C4ad6376892180d6fF8612e3Fa68` | Coinbase SPCX | 146.72 | 1.000000 |
| TSLAc | `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` | Coinbase TSLA | 391.04 | 1.000000 |

| Item | Finding | Status |
|---|---|---|
| Form | Proxy with `version()` 6, 8 decimals, one aggregator per feed | Verified onchain for all 8 |
| Owner | All 8 proxies are owned by one Safe 1.3.0, 4 of 9: `0xf0Db7318A51a21C413CaDd4AbDC1E8a500fE5B1b`. The same Safe owns Chainlink's ETH / USD (`0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`), BTC / USD and USDC / USD feeds on Base | Verified onchain on 19 November 2026 |
| Multiplier | The registry multiplier equals the token's own `uiMultiplier()` for all 8 (WAD, 1e18) | Verified onchain |
| Pause | `paused` is false for all 8 in the registry | Verified onchain at the read |
| Age | At 11:56 UTC on a Thursday (US pre-market) the last updates were 13 minutes (NVDA) to 11 hours (AAPL) old. Base Docs: 0.5% deviation or 24 hours in market hours, held when closed | Ages verified onchain. Heartbeat and deviation from Base Docs only |
| Weekly rhythm | Round history from 11 to 19 November 2026 (NVDA 415 rounds, MSFT 96, AAPL 33): the last write of the week came on Friday afternoon or evening ET, then nothing until Sunday 20:00 ET sharp, when every feed wrote. Gaps over the weekend: 49.4 hours (NVDA), 51.9 hours (AAPL), 52.0 hours (MSFT). The longest gap on a weekday was 17.2 hours (AAPL, Tuesday to Wednesday): a quiet stock does not write for most of a day | Verified onchain for these three feeds and this week. No holiday was in the range |
| Aggregator and phase | Every proxy is in phase 2, in front of an `AccessControlledOCR2Aggregator 1.0.0`. AAPL's phase 2 began on 5 August 2026, but its phase 1 aggregator still got rounds until 14 August 2026, so an old phase is not a record of what the proxy served (D-97) | Verified onchain on 20 November 2026 (phase and type for all 8, the overlap for AAPL) |
| History read (BE-97) | `getRoundData` through Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) read every round of all 8 feeds from 23 October to 20 November 2026 with no gap in round ids: 4,177 rounds, from 204 (AAPL) to 887 (NVDA). Block time measured at 0.2 seconds. The public endpoint `https://mainnet.base.org` refused `eth_getLogs` from our machine, while `eth_call` worked | Verified on 20 November 2026 |
| Other feeds | Base Docs also list Coinbase MSTR `0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a` and Coinbase SNDK `0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA` (descriptions verified onchain). No Morpho market was found for these two, and their token addresses were not found | Not in scope until a market exists |

## X Layer (chain 196)

Read from the X Layer RPC (`https://rpc.xlayer.tech`, block 76329283), the Morpho API, Morpho Docs and Circle's docs on 19 November 2026 (SC-80 and SC-81). Every address below has code on X Layer mainnet at that block.

### Infrastructure (SC-80)

| Contract | Address | Status |
|---|---|---|
| Morpho (Blue core) | `0xeb00C490E888286357dC5B0a35D37D9260D11Ab5` | Verified onchain. Address from Morpho Docs and the Morpho API |
| AdaptiveCurveIrm | `0x5688FF1aBC4089cB69dC0F56727E696A49D77E24` | Verified onchain: `MORPHO()` is the core above |
| MorphoChainlinkOracleV2 factory | `0x625Eb26d759ef8077202d4a5A63098B4B28616Db` | Code present. Address from Morpho Docs |
| Vault V2 factory | `0x63D6eAc0d16D57dd131D9023ADb060277d3237d7` | Code present. Address from Morpho Docs |
| MorphoMarketV1AdapterV2 factory | `0xDD0FC0c74bd89A9C6623202473E75CbF472b33A4` | Code present. Address from Morpho Docs |
| MorphoVaultV1Adapter factory | `0xFb1887f36664AAc366FA2aCf1532d99f1743b851` | Code present. Address from Morpho Docs |
| MorphoRegistry | `0xe9F2A824Eb33B97D0F7b3266A569d71342104829` | Code present. Address from Morpho Docs |
| BluePublicAllocator (for Vault V2) | `0x1b7C60330E3aFe5bA876F518Ff14316EA497f683` | Verified onchain: `vaultV2Factory()` is the factory above |
| VaultBundlesV1 | `0xB9c332379D8Fba06b55e7ecF446E03a3365be8FE` | Code present. Address from Morpho Docs |
| MetaMorpho (Vault V1) factory | None | Morpho Docs list no Vault V1 section for X Layer, the v1.1 factory addresses of Ethereum, Base and Monad have no code here, and the Morpho API lists 0 Vault V1 vaults and 5 Vault V2 vaults on chain 196 (Gauntlet, Steakhouse, Spark). Verified on 19 November 2026 (Q-44) |
| USDC (native, Circle) | `0xB6CEceAB302E2E4948951eE7843FC24E92933061` | On Circle's official list for X Layer. FiatToken `version()` 2, 6 decimals, supply about 106 million. Every xStocks Morpho market lends it. CCTP domain 37 (standard and fast transfer) |
| Second USDC (`USD Coin`, 6 decimals) | `0x74b7F16337b8972027F6196A17a631aC6dE26d22` | Code present, supply about 775,000, owner and master minter one address. Circle says a bridged `USDC.e` exists on X Layer that it does not issue; that this is it is not verified. Not used by Levra |
| USDT | `0x1E4a5963aBFD975d8c9021ce480b42188849D41d` | Code present, `symbol()` "USDT", 6 decimals. Not used yet |
| Wrapped OKB | `0xe538905cf8410324e03A5A23C1c177a474D59b2b` | Code present, `symbol()` "WOKB" |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Code present (canonical address) |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | Code present (canonical address) |
| Safe 1.4.1 singleton | `0x41675C099F32341bf84BFc5382aF534df5C7461a` | Verified onchain: `VERSION()` is "1.4.1" |
| Safe 1.4.1 L2 singleton | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` | Code present (canonical address) |
| Safe 1.4.1 proxy factory | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` | Code present (canonical address) |
| OKX DEX router | `0x7c5bee2a8091c3ef39072f64f18fac913060aeaf` | The `tx.to` of a v6 swap on chain 196 (OKX DEX API, 20 November 2026). Code present |
| OKX DEX approve contract | `0x8b773D83bc66Be128c60e07E17C8901f7a64F000` | `dexTokenApproveAddress` for chain 196 in the v6 supported chain list. Tokens must be approved here, not to the router: on a fork a swap reverted with only the router approved (Q-47) |

| Uniswap v3 SwapRouter02 | `0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA` | Verified onchain: `factory()` is the Uniswap v3 factory `0x4B2ab38DBF28D31D467aA8993f6c2585981D6804` that holds the wQQQx / USDC pool, `factoryV2()` and `positionManager()` answer, `WETH9()` is WOKB, and the code holds the `exactInputSingle` selector of SwapRouter02. Found as the target of a real swap in that pool. Second swap target on X Layer (D-85) |

The listed xStocks markets and their IDs are under "Wrapped xStocks" below.

### Swap cost through OKX DEX (BE-81)

OKX DEX API v6 on chain 196, 20 November 2026 around 03:00 UTC, against the xStocks feed price, in basis points (positive: paying more than the oracle when buying, getting less when selling).

| Stock | Buy $100 | Buy $1,000 | Buy $10,000 | Buy $50,000 | Sell $1,000 | Sell $10,000 | Sell $50,000 | Venues at $1,000 |
|---|---|---|---|---|---|---|---|---|
| wQQQx | 10 | 12 | 17 | 28 | -4 | -1 | 15 | Caliber propAMM, Uniswap V3 |
| wSPYx | 6 | 3 | 11 | 28 | 4 | 10 | 28 | JIT Router, Uniswap V3 and V4 |
| wGOOGLx | 3 | 7 | 28 | 104 | 13 | 28 | 59 | JIT Router, Uniswap V3 and V4 |
| wNVDAx | 8 | 11 | 44 | 137 | 8 | 45 | 250 | Uniswap V3 and V4 |

The API needs a key, secret and passphrase, and no project ID; v5 is retired. Our ISPs (XL, Telkomsel) redirect `web3.okx.com` by DNS, so scripts resolve it through 1.1.1.1. Verified by quote only on this date.

### Full long and short on an X Layer fork (SC-83)

`make xlayer-fork-e2e` on 20 November 2026: the real deployment script with `config/xlayer.json` on a local fork, then a user with 1,000 USDC:

| Step | Route | Result |
|---|---|---|
| Open NVDA long, $100 margin and $100 borrowed | OKX DEX (approve contract as spender, D-88) | 1.34104 wNVDAx collateral |
| Open QQQ short, $50 of stock | Uniswap SwapRouter02, wQQQx / USDC pool | Borrowed wQQQx |
| Close the long in full | OKX DEX | Debt and collateral 0 |
| Close the short in full | OKX DEX | Debt and collateral 0 |

The router ended with no USDC, wNVDAx or wQQQx. The user ended with 997.65 USDC and 0.00227 wQQQx (the buy back surplus), about $0.85 for both round trips. Calldata came from the live OKX DEX API; the transactions ran on the fork only. The OKX DEX router for the swap allowlist comes with SC-83.

### Stocks listed at launch (D-68)

| Stock | Wrapped token | Underlying xStock | Morpho oracle | Price feed (proxy) |
|---|---|---|---|---|
| wQQQx | `0x4C1AE29c159838fC1b224636E28E086EB69101f7` | `0xa753A7395cAe905Cd615Da0B82A53E0560f250af` | `0x110e7de022cb034d017806AA97d9B69B2023A61c` | `0x70149e006a03dF3739B8C37E4d80145Dea4c09F6` |
| wNVDAx | `0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5` | `0xc845b2894dBddd03858fd2D643B4eF725fE0849d` | `0x787f5aCC336AFB68f72F125a5E20B0f0849E27dd` | `0x761FE3B4C1043862bB0c53F5fAAe19F159F6b303` |
| wSPYx | `0xE7E553Cd128F0011777323A0b44a7b96EA1CB540` | `0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48` | `0xB03Fa908cd4BaD0fa962929cdc53716Eff94b810` | `0xFf1Ad069D1500970e5f0e5375b011C24EA819950` |
| wGOOGLx | `0xf8c5308F80E459bb53d9EbE689854d9cBb2Caa6f` | `0xe92f673Ca36C5E2Efd2DE7628f815f84807e803F` | `0x40d4877fEDdc2bbAD31B1F5c33E724e33C5bc41B` | `0x64B67C4C176E78064E0470a062C83c17AE0FA779` |

Each Morpho oracle uses only `BASE_FEED_1` (no second feed, no quote feed, no vault). All four markets lend USDC.

Price scale for 18 decimal stocks: on 20 November 2026 (X Layer block 76387225), each of the four Morpho oracles above answered exactly our long formula, feed answer × 10^16 (`morphoOraclePrice` in `math.ts`, the same `SCALE` as `ChainlinkSessionOracle`), and the short formula gives one USDC = 10^8 / answer whole tokens. The same check on the eight Base oracles in the next section (Base block 59829408) gave feed × 10^26 for 8 decimal stocks. Verified by BE-92 (`packages/shared/limits.test.ts`).

### Price feeds

| Item | Finding | Status |
|---|---|---|
| Contract | Proxy (`version` 6, phase 1) in front of `AccessControlledOCR2Aggregator 1.0.0`, with 10 transmitters. Names end in "(Calculated)", 8 decimals | Verified onchain |
| Owner | Proxy and aggregator are owned by a Safe 1.3.0, 4 of 9: `0xd9F6f0C071AE8d804129309fa7bB371626eafb04`. Same owner for all four feeds. The same Safe owns the proxy and the aggregator of Chainlink's ETH / USD, BTC / USD, USDC / USD and OKB / USD feeds on X Layer, and all four xStocks feeds are listed as "TokenizedEquities" in Chainlink's feed directory for X Layer (`reference-data-directory.vercel.app/feeds-ethereum-mainnet-xlayer-1.json`, the data behind docs.chain.link) | Verified onchain on 19 November 2026. Answers Q-42 |
| Update rhythm | About one round every 1 to 3 minutes on weekdays, also outside US market hours (feed ages 71 to 206 seconds at 04:00 ET) | Verified onchain |
| Weekends | wNVDAx stopped from Saturday 14 November 00:59 UTC (round 11859) to Monday 16 November 01:00 UTC (round 11860), that is Friday 20:00 ET to Sunday 20:00 ET. So the feeds run 24/5 | Verified for one weekend on wNVDAx |
| Bounds | `minAnswer = 1`, `maxAnswer` near the int192 maximum, so the aggregator has no useful price floor | Verified onchain. Our adapter needs its own bounds (D-69) |
| History read (BE-97) | All four feeds are in phase 1 and their round 1 was written on 23 October 2026 (22:43 to 22:50 UTC), so their whole history fits in the 28 day backfill. Read on 20 November 2026 with no gap in round ids: 39,994 rounds (NVDA 16,436, QQQ 8,363, GOOGL 10,898, SPY 4,292). Block time measured at 1 second. The public endpoint `https://rpc.xlayer.tech` allows `eth_getLogs` over about 100 blocks only, and answered HTTP 403 for about a minute after the backfill's burst of calls, then recovered | Verified on 20 November 2026 |

### Wrapped xStocks (all four checked on 19 November 2026)

| Item | Finding | Status |
|---|---|---|
| Form | ERC-4626 style wrapper over the xStock, 18 decimals. The wrapper rate absorbs the underlying multiplier, so balances do not change by themselves. 1 wrapped token converts to 1.0017 NVDAx, 1.0035 QQQx, 1.0075 SPYx and 1.0024 GOOGLx | Verified onchain |
| Same code | All four wrappers share one implementation (`0x76c6851ea0b2741eedcbbed240715e8817e85583`) and all four underlying xStocks share another (`0x65c40d624af3b18c109fbf87b7deff34cdc5f19b`) | Verified onchain |
| Upgrades | Transparent upgradeable proxies with separate admins: wrapper `0x312063009e74142339edc92bcff6cfcfaa958bfa`, underlying `0x696c685a02a1fc6e2aacbe26cd6695f4f4a6a085`, the same for all four. The token rules can change | Verified onchain |
| Pause | All eight contracts have `pauser()` = `0x8768cDA7A463DAe1baA6b2500EFB025ebd7FFC50` (a Safe, threshold 2) and `isPaused()` = false. A pause can block closes, as on Base | Verified onchain |
| Sanctions | The underlying has `sanctionsList()` = `0x615Dd3B9445A94334C1579F68115042D77CC7c44` (Sourcify name `SanctionsListDeployment`, `isSanctioned(address)`), the same for all four. Morpho is not listed. On a fork, adding a contract to the list makes a wrapped token transfer to it revert, so the list reaches the wrapped token too | Verified onchain and on a fork (`test/XStocks.t.sol`) |
| Owners | The four wrappers and the sanctions list are owned by `0x49754062E35f7591B93cc4F9915965be89643a65`, a Safe 2 of 3 | Verified onchain |
| Moves through Morpho | On a fork at block 76327204, each wrapped token goes from Morpho to a contract standing for our router, is supplied as collateral and withdrawn on its listed Morpho market, is pulled with `transferFrom` by a contract standing for our liquidator, and goes back | Verified on a fork (`test/XStocks.t.sol`) |
| Morpho on X Layer | Morpho core `0xeb00C490E888286357dC5B0a35D37D9260D11Ab5`, IRM `0x5688FF1aBC4089cB69dC0F56727E696A49D77E24` (from the Morpho API). Listed markets lend USDC `0xB6CEceAB302E2E4948951eE7843FC24E92933061`: wNVDAx 77%, wQQQx 86%, wSPYx 86%, wGOOGLx 77%, each about half borrowed | Read from the Morpho API and the fork. The full address check is SC-80 |

### TapeOut transistors (Q-40)

Read from the X Layer RPC on 19 November 2026, plus community repos (tapeout-forge `docs/COSTS.md`, fabx-minter, fusebox, lingxi). There is no official TapeOut document on this.

| Item | Finding | Status |
|---|---|---|
| Tape out needs transistors | A processor's `tapeout(bytes netlist, uint32 nIn, uint32 nOut)` is payable and reverts unless the caller holds at least as many transistors as the circuit has gates. They are burned. One gate is one transistor | Verified from the revert data reported in tapeout-forge, not run by us |
| Tape out fee | `TAPEOUT_FEE()` = 0.0013 OKB on both processors below, plus gas | Verified onchain |
| FAB-Genesis processor | `0x87BFCa3494Aa228fF589ab9B642143A5e8c8F9a6`, transistors `0xBe6f94115D32f3AC3252bc4626573e739bEeb714`: 1,000,000 of 1,000,000 minted, sold out | Verified onchain |
| OrderGuard processor (used by Fusebox) | `0x57F319CF056F72F48cF1dbb670F2A3DB007Aa355`, transistors `0x8e71FC45ff47E5a7bA1ad2960793ebAdD2739D9e`: 785 of 10,000 minted, so 9,215 left and shared with every other builder. `mintPrice` 0.0001 OKB per transistor, `protocolFee` 0.00066 OKB per mint transaction | Verified onchain |
| Factory | `0x1f09DAeFA827f02CBb40967cc91b259763760761` (from TapeKit) lists 430 processors (`cpuCount`). How a new processor is created, its fee, and whether it brings its own transistor supply are not documented | Count verified onchain. Creation not verified |
| Other chains | TapeOut also runs on Base (same addresses as X Layer: factory, container opener, SiteRegistry, DomainBinding, TapeSend hub proxy `0xe61A9C7213a6Aa616C246a2B569e555B417b25ee`) and on BNB Smart Chain. Not on Monad. `cpuCount` is 106 on Base and 438 on X Layer | Code and counts verified onchain on 21 November 2026; addresses from the TapeKit README |
| Reading a circuit | `eval`, `step` and the netlist reads are used by other apps without a wallet or transistors | From community repos. Not tested by us |
| Size risk | Health factor math (multiply and divide on large numbers) as plain gates may need tens of thousands of gates, more than the OrderGuard supply left. A circuit that only compares values computed off-circuit, or a sequential circuit using `step()` and LATCH gates, needs far fewer | Our estimate, not measured (BE-82) |

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
