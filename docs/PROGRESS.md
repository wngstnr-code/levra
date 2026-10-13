# Progress

One place to see where the build stands. Task checkboxes live in the task files. This file holds the milestones, blockers, checkpoint results, real transactions and the daily log.

Last updated: 13 October 2026

## How to update

- Tick tasks in your own task file, in the same PR as the work.
- Edit only your own rows and your own log entries here, so three people can edit this file without conflicts.
- Write a blocker the same day it appears.
- After each working day, add one to three lines to the daily log.

Count progress from a terminal:

```bash
for f in docs/tasks/*.md; do
  printf "%-28s done %s, in progress %s, not started %s\n" "$f" \
    "$(grep -c '^- \[x\]' "$f")" "$(grep -c '^- \[~\]' "$f")" "$(grep -c '^- \[ \]' "$f")"
done
```

## Milestones

Status values: not started, in progress, done. A milestone is done only when its integration checkpoint passes.

| Milestone | What exists at the end | SC | BE | FE | Checkpoint | Status |
|---|---|---|---|---|---|---|
| M0. Foundation and spikes | Repo, frozen interfaces, local mainnet fork, risky assumptions tested | SC-01 to SC-06 | BE-01 to BE-06 | FE-01 to FE-04 | I-0 | in progress |
| M1. Core long | Long on aQQQ works end to end on mainnet staging | SC-10 to SC-15 | BE-10 to BE-16 | FE-10 to FE-13 | I-1 | not started |
| M2. Short and Earn | Short, lending, all five markets | SC-20 to SC-24 | BE-20 to BE-23 | FE-20 to FE-22 | I-2 | not started |
| M3. Market-hours protection | Soft limits by session, alerts, auto-deleverage, liquidator bot | SC-30 to SC-32 | BE-30 to BE-34 | FE-30 to FE-33 | I-3 | not started |
| M4. Cross-chain deposits | Deposit from and withdraw to other chains | SC-40 | BE-40 to BE-42 | FE-40 to FE-41 | I-4 | not started |
| M5. Hardening | Invariant tests, audit, monitoring, compliance gates | SC-50 to SC-56 | BE-50 to BE-55 | FE-50 to FE-55 | I-5 | not started |
| M6. Launch | Production deployment owned by the multisig, open to the public | SC-60 to SC-61 | BE-60 to BE-61 | FE-60 to FE-61 | I-6 | not started |

Milestones are ordered, but work inside a milestone runs in parallel. Work from a later milestone may start early when it does not depend on anything unfinished. For example BE-03 (one week of oracle logging), X-12 (talking to Anchored) and FE-04 (screen design) should start on day one.

## Task counts

Refresh with the command above.

| Area | Owner | Total | Done | In progress |
|---|---|---|---|---|
| Smart contracts | Wangsit | 30 | 9 | 16 |
| Backend | Dharu | 34 | 16 | 7 |
| Frontend | Nabil | 27 | 5 | 19 |
| Shared tasks | All three | 15 | 1 | 5 |
| Integration checkpoints | All three | 7 | 0 | 0 |

## What each person can start today without waiting

| Person | Start with | Why these |
|---|---|---|
| Wangsit | X-01, SC-01, SC-03, then SC-02 and SC-04 | The repo and the interfaces unblock everyone else |
| Dharu | BE-01, BE-02, BE-03, then BE-04 and BE-05 | The API shapes unblock Nabil. The oracle logger needs a full week, so it starts first |
| Nabil | FE-01, FE-02, FE-03, FE-04 | None of these wait for anyone. FE-03 reads real data straight from the chain |

## Blockers

Add a row the day a blocker appears. Remove it when solved and note the fix in the daily log.

| Date | Who is blocked | Waiting for whom | What is needed | Task |
|---|---|---|---|---|
| 13 October 2026 | Wangsit | Dharu, Nabil | One wallet address each for the team multisig (2 of 3 Safe). Needed for the handover of ownership | X-03, SC-55 |
| 13 October 2026 | Wangsit | Dharu | Four addresses for the mainnet roles: router keeper, `Liquidator` keeper, calendar poster, oracle age poster. Without them auto-deleverage, liquidations and the two posters cannot run on mainnet | BE-17, BE-30, BE-31, BE-32 |
| 13 October 2026 | Dharu | Dharu | KyberSwap client ID and Aurora Intents API key | BE-04, BE-05 |
| 14 October 2026 | Dharu | Dharu | Alert delivery services (Q-30): a Resend account with a sending address and a Telegram bot token, plus `AUTH_SECRET` and `AUTH_DOMAIN` for the API | BE-33 |
| 13 October 2026 | Dharu | Dharu | Envio HyperSync API token from app.envio.dev, so the indexer reads from HyperSync instead of the RPC endpoint | BE-06, BE-13 |
| 13 October 2026 | Nabil | Dharu | Approval of the signed message texts in 03 section 4 (terms acceptance and SIWE for alerts), and the endpoints that check them | FE-50, FE-31 |
| 13 October 2026 | Nabil | All three | An error reporting service for the web app (for example Sentry) and who receives the reports | FE-54 |
| 13 October 2026 | Nabil | Dharu | CORS on the API for the web origins (`https://levra-mon.vercel.app`, the Vercel preview addresses and `http://localhost:3000`), and a public staging address for `NEXT_PUBLIC_API_URL`. Without CORS the browser blocks every call from the web app | FE-10, FE-11, FE-12, FE-13 |
| 13 October 2026 | Dharu, Nabil | Dharu, Nabil | Paid Monad RPC provider and hosting for the backend, database and web app. Needed at staging, not before | BE-15, FE-01 |

## Open questions that block work soon

The full list, with options for each, is in 09 under "Decisions waiting for the team".

| Question | Owner | Why it is urgent |
|---|---|---|
| Q-25 Domain | Nabil | `levra.com`, `.io`, `.xyz` and `.app` are in use |

## Integration checkpoint results

| Checkpoint | Date | Run by | Result | Notes and transaction hashes |
|---|---|---|---|---|
| I-0 | | | | |
| I-1 | | | | |
| I-2 | | | | |
| I-3 | | | | |
| I-4 | | | | |
| I-5 | | | | |
| I-6 | | | | |

## Real transactions on Monad mainnet

Every important real transaction goes here. This is also the evidence for the hackathon submission.

| Date | What | Transaction hash | By | Task |
|---|---|---|---|---|
| 13 October 2026 | Deploy `RiskManager` | `0x208371c6ee6cc0307fbbc8a12bd066137a75614309de826dacbaec7cf23a0ef3` | Wangsit | SC-15 |
| 13 October 2026 | Deploy `MarginRouter` | `0x3f36c52b3b4c24979a4d288c84889a1824c6be7de4178c26c4b6f62d057feb7d` | Wangsit | SC-15 |
| 13 October 2026 | Deploy `Lens` | `0x485962141bac1d40e3ac5aba064e0c70c5d860dae1c3f399bcf874f3155decd4` | Wangsit | SC-15 |
| 13 October 2026 | Deploy `Liquidator` | `0xbea209d7bc6cab1234dcbedaf2bfc2db9509f9b16eed50c86fedc86dde7e6519` | Wangsit | SC-15 |
| 13 October 2026 | Create the QQQ long market on Morpho | `0x7ad5f7acb00402dd34030c4cc03526088d23d239f1c79f5a98adb2d0bd2ee707` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Create the HOOD long market on Morpho | `0xb58c3332667146cc047cff3e8ebc84ec330b501975351224b1e3cbb242ecb62c` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Create the BIL long market on Morpho | `0x4c963528bf82847392c4270ca45863617791ffba2d7bac933893a9a6c192a684` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Create the QQQ short market on Morpho | `0x6d4273e54978bdbec0e03c6d55f518f1270c19f41a64af0bfabbec32034b5a07` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Create the HOOD short market on Morpho | `0x54e3851ebcb8b1fe9f0d5d4057f04ce13e07018096e3495f685cfbc3addb1a3e` | Wangsit | SC-15, SC-22 |

| 13 October 2026 | Supply 2 USDC to the QQQ long market | `0x59f17d8679752d57b57d3011313f8d9c51171407bd8c94069a3c543341b250d2` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Authorize the router on Morpho | `0xc4ebec6ff8509e4235edc4b0c23eb9711cca8e73a3e4f54cdc8db0501df9cf47` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Open a QQQ long through the router | `0x12ae7b1179c7f16b89164d2a84bc34d18156278b3117528add662f2d21fff469` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Close the QQQ long in full through the router | `0xff7649bdd4624b6729738e6fa6ae2a7b1a6b46d6e85fe5a2bd21b3d59eaf8025` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Supply 2 USDC to the HOOD long market | `0xfdfc6cbe08618d62e70d42005e42195be5befbb0f2737765c6e7e25a9e596810` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Open a HOOD long through the router | `0x85c02221e5650892386c0b7a4a0aba5c5ef22b591baab7f56f40d327219b5928` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Close the HOOD long in full through the router | `0x7cfd878ba71cd343c93f4c3fdc761b0bf3dc773357fc595708310b09ebfc64e4` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Supply 2 USDC to the BIL long market | `0x4ae62682055d409587da5348831395ca9a7eeba6fe91e06a69bae92a412bb927` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Open a BIL long through the router | `0xce7ce3b06044cc9bc9d0b0572c4b72acb36557bfd8f582e0305fe872fb8e9f83` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Close the BIL long in full through the router | `0x8a1b837d221fb47215ed22d97716eb5b1ef8c36bcaf7fe74bb53bb541252e71a` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Buy QQQ stock with 2 USDC on the exchange | `0x1762a8795b3272ab761007bb6367970c289a77d2106fc457b33b26ee2d15f9f5` | Wangsit | SC-24 |
| 13 October 2026 | Lend the QQQ stock to the QQQ short market | `0x3287cd4b0787b8c6852806d59b66bcc54586d678feeb010cd2d618d0395089fa` | Wangsit | SC-24 |
| 13 October 2026 | Open a QQQ short through the router | `0x9e45649e144c5087f49e500bc5c5aab0e6da4bb51d2dce6ab661fe6b27a38a06` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Close the QQQ short in full through the router | `0x1b5c95c28d3b96a82e66b473e65c508c80f8ddab432f9f8495797e2ea41782ee` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Buy HOOD stock with 2 USDC on the exchange | `0x098d533739a0f527a4869ea0c530d65778d8441d1c047418528a01ddb2fd934d` | Wangsit | SC-24 |
| 13 October 2026 | Lend the HOOD stock to the HOOD short market | `0x5c3c20f1f83754e4444be577ea042beaeda2f50050364a9c6752ca01389e742d` | Wangsit | SC-24 |
| 13 October 2026 | Open a HOOD short through the router | `0x44e4302b500827dba704324168ef3eab7c59f5aa0b9e5ee6a7f0b9f4d882946d` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Close the HOOD short in full through the router | `0x79983f5421c5728e862745aff2265439db2f5484e3c219b02d785a578c84d8d2` | Wangsit | SC-15, SC-22 |
| 13 October 2026 | Create the USDC vault from Morpho's factory | `0x4c308c69ce9f0031bd94d79b78d3c035284676f636439553ea8333175d8ea9c5` | Wangsit | SC-23 |
| 13 October 2026 | Deposit 1 USDC into the USDC vault. It reached the QQQ long market | `0x6233049c3bbede60e67b0863a3389014dc1243dd795e85f9a18e234513c7817a` | Wangsit | SC-23 |
| 13 October 2026 | Redeem all vault shares. 1 USDC came back in full | `0xa52645ee0a4d62838641791419e89b7bc8d5fb740a2207c88762de86b8eda689` | Wangsit | SC-23 |
| 13 October 2026 | Deposit 1 USDC into the USDC vault and leave it there for the demo | `0xeb609d4b4cf13a08b5c6b6990c52aae302761d3117f19f3f2c006fcaa38294f0` | Wangsit | X-16 |
| 13 October 2026 | Open a QQQ long that stays open for the demo (margin 1.5 USDC, borrow 1.5 USDC) | `0x291fae73e1e2c98970d57d916a288c23c56fee3f9d4dd58700f10fa225e80ad5` | Wangsit | X-16 |

The deployment was 25 transactions in blocks 113046474 to 113046617, all successful. The other 16 are the five `SessionOracle` deployments and the fee and market settings.

The first run was 30 transactions in blocks 113050112 to 113050539, all successful, sent by `make first-run-monad` from the deployer wallet `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`. The 12 not listed are token approvals. Every position was closed in full and the router held no tokens after each close.

The vault was 11 transactions in blocks 113058663 to 113058727 (create, three supply caps submitted and accepted, supply queue, fee recipient, fee, timelock), 0.73 MON. A first deposit and withdrawal of 1 USDC followed in blocks 113060117 and 113060133. A second deposit of 1 USDC in block 113063214 stays in the vault, so the Earn screen has real data: the deployer wallet holds 1 `lvUSDC`, lent to the QQQ long market.

One position is open on purpose: the deployer wallet holds a QQQ long of 0.00409 aQQQ against 1.5 USDC of debt, at 49.4% loan-to-value, with protection off. It gives the Positions screen real data.

## Deployed addresses

The binding source is `contracts/deployments/*.json`. This table is a convenience copy for humans.

| Environment | Contract | Address | Date |
|---|---|---|---|
| Monad mainnet, staging | `MarginRouter` | `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6` | 13 October 2026 |
| Monad mainnet, staging | `RiskManager` | `0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F` | 13 October 2026 |
| Monad mainnet, staging | `Lens` | `0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8` | 13 October 2026 |
| Monad mainnet, staging | `Liquidator` | `0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39` | 13 October 2026 |
| Monad mainnet, staging | `SessionOracle`, QQQ long | `0xbec7D067ad0071AF3B500442537A7E7622C596d3` | 13 October 2026 |
| Monad mainnet, staging | `SessionOracle`, HOOD long | `0xB8E3ec1BCd1988D5aD35d0A0219F767944737465` | 13 October 2026 |
| Monad mainnet, staging | `SessionOracle`, BIL long | `0x2Fd501ae3Cf16DDe20322b0985A96A53f195640B` | 13 October 2026 |
| Monad mainnet, staging | `SessionOracle`, QQQ short | `0xB08Cb2B0ba10E6a8A3e5Bda7a240a9c6E6CF6bC7` | 13 October 2026 |
| Monad mainnet, staging | `SessionOracle`, HOOD short | `0xaFe518da5cBa30B198e96F26074f66f85241DE95` | 13 October 2026 |

| Monad mainnet, staging | USDC vault `Levra USDC` (`lvUSDC`), MetaMorpho v1.1 | `0xfB99A7E3f5571baA363d67F7823bb354cfd95447` | 13 October 2026 |

Market IDs are in `contracts/deployments/monad.json`.

## Interface changes

One line for every change to 03 after the freeze.

| Date | What changed | Who is affected | PR |
|---|---|---|---|
| 13 October 2026 | Added section 4 "Signed messages": the terms acceptance text and the SIWE fields for alerts. Proposed, waiting for Dharu | Dharu, Nabil | fe/FE-50-55-m5-hardening |
| 13 October 2026 | Added the source quote time: `feedUpdatedAt` in `ISessionOracle.snapshot()` and `ILens.MarketView`, `oracleFeedUpdatedAt` in `Market`, `feedUpdatedAt` in the `price` stream event (D-23) | All three | sprint/long-flow |
| 13 October 2026 | Added `marketIds()` and `positionLtv()` to `IRiskManager` | Wangsit, Dharu | sprint/long-flow |
| 13 October 2026 | Added `GET /v1/config` and the deployment file schema in `packages/shared/deployments.ts` | Dharu, Nabil | sprint/long-flow |
| 13 October 2026 | Added `ILiquidator` and `liquidatorAbi` for the liquidator bot. The deployment file now carries `liquidator` and, after the vault script runs, `usdcVault` | Dharu | sprint/long-flow |
| 13 October 2026 | Added the oracle age poster to `IRiskManager`: `oracleAgePoster()`, `oracleAgeBounds()`, `setOracleAgeBounds()`, `setMaxOracleAge()`, two events and the error `OracleAgeOutOfBounds` (D-31). `ISessionOracle` now exposes `MAX_FEED_AGE()` and `MAX_PUBLISH_AGE()` | Dharu | sc/SC-11-oracle-age-and-repay |
| 13 October 2026 | Added `repayDebt()` and the event `DebtRepaid` to `IMarginRouter` (D-32). The API has no quote or history type for it yet | Dharu, Nabil | sc/SC-11-oracle-age-and-repay |
| 13 October 2026 | `Market.dexMidPriceE8` and `dexDeviationBps` are now filled from the depth keeper (D-36 mid price, null when older than 30 minutes); `marketDepth` added to the keeper names. No shape change | Dharu, Nabil | be/BE-04-market-depth |
| 13 October 2026 | Added `borrow` to the history types, for a loan taken straight on Morpho | Dharu, Nabil | be/BE-13-morpho-events |
| 13 October 2026 | Added `oracleAgePoster` to the keeper names in `/v1/status` | Dharu, Nabil | be/BE-17-oracle-age-poster |
| 13 October 2026 | Added `repayDebt` to the history types and `repay` to the collateral quote actions, so the app can add margin with USDC (D-32) | Dharu, Nabil | be/BE-13-indexer |
| 13 October 2026 | Account and history notes in 03: positions live from `Lens`, when entry price and PnL are `"0"`, the history query parameters. No shape change | Dharu, Nabil | be/BE-13-indexer |
| 13 October 2026 | `IAnchoredStockOracle` gained the other read functions of the live oracle (`latestPriceNoOlderThan`, `latestPrices`, `latestPricesNoOlderThan`, `isSupportedPriceId`, `hasPrice`, `description`). The ABI is regenerated | Dharu | sc/Q-28-oracle-ages |
| 13 October 2026 | `morphoAbi` now also carries Morpho's 17 events (`SupplyCollateral`, `Borrow`, `Repay`, `Liquidate` and the rest), taken from Morpho's own `EventsLib` at the deployed version. Nothing was removed | Dharu | sc/morpho-events-abi |
| 13 October 2026 | Quote rules in 03: `gasLimit` `"0"` when not simulated, uint256 in `typedData` as decimal strings, where realized PnL comes from, warning thresholds. No shape change | Dharu, Nabil | be/BE-12-quote-long |
| 13 October 2026 | Wrote down what `Market.oracleStale` means (hard check, or older than `maxOracleAge` outside `CLOSED`) and when the DEX price fields are null. No shape change | Dharu, Nabil | be/BE-10-chain-reader |
| 13 October 2026 | Added the `PriceUpdated` event to `IAnchoredStockOracle` and its ABI, for the oracle logger. Written by Dharu, needs Wangsit's review | Wangsit, Dharu | sc/BE-03-oracle-price-event |
| 13 October 2026 | Added the `NEXT_PUBLIC_PRIVY_APP_ID` environment variable (section 7) | Nabil | fe/FE-01-03-m0-foundation |
| 14 October 2026 | Added `POST` and `DELETE /v1/alerts/telegram` and `TelegramLinkResponse`; wrote down the sign-in rules (D-38) and when alerts go out | Dharu, Nabil | be/BE-33-alerts |
| 13 October 2026 | Wrote down `MarketDetail` history rules in 03: 30 days, one point per hour, empty without a database, 404 for an unknown stock | Dharu, Nabil | be/BE-23-market-detail |
| 13 October 2026 | `EarnPosition.earnedRaw` is now signed, since bad debt can make it negative. Earn option ids are `vault:<address>` and `market:<marketId>` | Dharu, Nabil | be/BE-22-earn |
| 13 October 2026 | Added `@levra/shared/deployments/monad`, which exports `monadDeployment`: the mainnet deployment file, validated and bundled. Nothing was removed | Dharu, Nabil | sc/SC-15-mainnet-deployment |

## Daily log

Newest first. One to three lines per person per working day: what got done, what is next, any blocker.

### 14 October 2026

- Dharu: BE-33 written: wallet sign-in (D-38), alert settings, Telegram linking, and the alerts keeper (before-close at 24, 4 and 1 hours, LTV threshold, auto-deleverage, liquidation, deposits). Fork test passes with a stand-in email channel. Waiting on Dharu: the delivery services (Q-30) and their keys. Next: BE-50 team monitor.
- Nabil: merged M1 to M5 into main (PRs #44 to #51). Earn now shows a loss in red, since `earnedRaw` can be negative. The English only decision is D-39, because D-38 went to wallet sign-in.
- Nabil: FE-04 done: Wangsit and Dharu approved the wireframes and the visual design.

### 13 October 2026

- Nabil: fixed the leverage slider stuck at 1× while the service is offline: limits now come from RiskManager on chain. A sweep of 20 controls on every page in Chromium passes. The analytics script now loads only on Vercel.
- Nabil: decided D-38, the app is English only. The Indonesian file and the language switch are removed; all text stays in one message file. 50 unit tests and 23 end-to-end tests pass.
- Nabil: decided D-39, the app is English only. The Indonesian file and the language switch are removed; all text stays in one message file. 50 unit tests and 23 end-to-end tests pass.
- Nabil: M5 frontend built on `fe/FE-50-55-m5-hardening`: region and terms gates (closing and withdrawing never gated), Help with words, risks and every address, error screens and cookieless metrics, a phone tab bar and better contrast, Playwright in CI (33 tests on desktop and phone, two languages). Waiting for BE-52, X-11 and an error service.
- Nabil: M4 frontend built on `fe/FE-40-41-m4-deposits`: cross-chain deposit with a QR code, expiry and a status tracker, and withdraw with a checked USDC transfer. Waiting for BE-40 and BE-41.
- Nabil: M3 frontend built on `fe/FE-30-33-m3-protection`: protection switches, the close countdown and pre-close banners, Settings with alerts behind a wallet sign-in, Morpho authorization, wallet and language, and a gap slider on the shared formula. Waiting for BE-30, BE-33 and SC-30 on mainnet.
- Nabil: M2 frontend built on `fe/FE-20-22-m2-short-earn`: short on the trade form, Earn with the vault and stock lending read and sent straight on chain, and the market detail page. Waiting for BE-20, BE-21 and BE-23 for short quotes, APY and market detail data.
- Nabil: M1 frontend built on `fe/FE-10-13-m1-core-long`: markets on the service with a live stream and an oracle fallback, the long trade form with first-use signatures and a checked transaction, positions with collateral, repay, reduce and close, history sentences, status banners, and every text in English and Indonesian. Waiting for Dharu: CORS and a hosted staging API.
- Nabil: visual design for every screen is on the Figma page "Design" (dark, pastel bento). Decided D-37: the landing site is separate (`apps/landing`, root domain) and the app runs on `app.<domain>`. New task FE-62; FE-60 is now the app domain only.
- Dharu: BE-31 done: the protector reduces protected positions above the soft limit to the target in the last 30 minutes before close, with the 04 formula and a live route; fork test passes for a long and a short, and leaves unprotected positions alone. Request for Wangsit: add `isKeeper()` to the `MarginRouter` ABI export (fragment until then). Next: BE-33 alerts.
- Dharu: BE-30 calendar poster written: the keeper keeps `nextCloseAt` at the next close, regular until a weekend is observed and then the observed one, with no code change; fork test passes. Request for Wangsit: add `calendarPoster()` to the `RiskManager` ABI export; the keeper uses a fragment until then. Mainnet posting waits on the role address and hosting. Next: BE-31 protector.
- Dharu: BE-23 done: `/v1/markets/:symbol` with both sides, the latest depth run and hourly rate and deviation history; the depth keeper now stores rate snapshots. Next: BE-30 calendar poster.
- Dharu: BE-22 and BE-21 done: the indexer stores vault deposits and withdrawals, and `/v1/earn` and `/v1/earn/:address` give the USDC vault and stock lending with APY, supplied, borrowed share, withdrawable and earned, matching chain reads on a fork. Request for Wangsit: add MetaMorpho (`totalAssets`, `fee`, `withdrawQueue`, `maxWithdraw`) to the ABI export; the API uses a fragment until then. Next: BE-23.
- Dharu: BE-20 done: short quotes (open, reduce, close) ran end to end on the fork from quote data, with first-use signatures; accounts and history give shorts an entry price and PnL. Also in this PR: the shared gap helper (BE-34) and the exchange calendar (BE-30), plus tables for the Earn, alert, deposit and terms tasks.

- Wangsit: `make close-all-monad` written and rehearsed on a fork of the live state: a long, a short and a vault deposit were all closed and the Lens showed no position left. It is the command to run after the demo video is recorded.
- Nabil: FE-05 started: the Figma design system is in `apps/web` (Tailwind tokens, SF Pro with Inter fallback, base components, header with a live market session). Markets keeps its data and moves to the new look next.
- Wangsit: state left on mainnet for the demo, all in the deployer wallet `0x70297E9b7f4cCE6272Ef830e3Df8744760bC1855`: one open QQQ long (Positions screen) and 1 USDC in the vault (Earn screen). Both are to be closed after the video is recorded.
- Wangsit: SC-23 done. A real deposit and withdrawal went through the USDC vault on mainnet with `make first-earn-monad`: 1 USDC in, all of it lent to the QQQ long market by the vault, 1 USDC back in full. The vault is empty again. Dharu and Nabil can use `monadDeployment.usdcVault` for the Earn screen.
- Wangsit: the USDC vault is live on mainnet (SC-23): `Levra USDC` at `0xfB99A7E3f5571baA363d67F7823bb354cfd95447`, created from Morpho's factory, read back from the chain: caps 10,000 QQQ, 5,000 HOOD, 20,000 BIL, fee 10%, timelock 1 day, owner the deployer wallet. It is in `monad.json` as `usdcVault`. One QQQ long is left open in the deployer wallet for the demo. `make first-earn-monad` is written and rehearsed on a fork of the live state: 1 USDC went into the vault, reached the QQQ market and came back in full. Next: run it on mainnet.
- Wangsit: `make set-roles-monad` written and rehearsed on a fork: it sets the router keeper, the `Liquidator` keeper, the calendar poster and the oracle age poster from the owner wallet, and skips what is already set. `Deploy.s.sol` now reads `LIQUIDATOR_KEEPER` separately, as Dharu asked for BE-55. Safe supports Monad, so the multisig can be made at app.safe.global. The Anchored message is updated for the staging deployment. Waiting for: four role addresses from Dharu, one wallet address each from Dharu and Nabil.
- Wangsit: public contract documentation written in `docs/public/contracts.md` (SC-61) and linked from the root README, which now shows the mainnet addresses. Bug bounty drafted in `docs/drafts/bug-bounty.md` (SC-56). New question Q-29: bounty rewards and the private reporting channel. For Nabil: the Help page can take its contract text from `docs/public/contracts.md`.
- Dharu: staging run against the mainnet deployment on Dharu's machine: the indexer saw Wangsit's first-run transactions, markets, status, account and history answered correctly, KyberSwap accepts the mainnet router, and the price stream delivered live oracle writes 1 to 2 seconds after publication (BE-11 done). Fixed: a full close of a short showed as a reduction. Waiting: hosting and a paid RPC provider for BE-15.
- Wangsit: first real run on mainnet (SC-15, SC-22, SC-24, SC-04): a long on QQQ, HOOD and BIL and a short on QQQ and HOOD, each opened and closed in full through the live KyberSwap route, 30 transactions, all successful. Cost: about 0.29 USDC and 2.20 MON. The wallet started with 15.98 USDC and ends with 5.72 free, 6 supplied to the three long markets and about 3.9 of stock lent to the two short markets. Hashes are in the table above, measurements in 05.
- Wangsit: the contracts are deployed on Monad mainnet (SC-15, staging): router, risk manager, lens, liquidator and five markets, in 25 transactions for 1.87 MON. Read back from the chain: owners, fees, limits, oracle ages and prices match the plan. Addresses are in `contracts/deployments/monad.json` and in `@levra/shared/deployments/monad`. Keeper, calendar poster and oracle age poster are not set yet. The source of all nine contracts is verified on Sourcify. Next: the first real long and short once the wallet holds USDC.
- Dharu: BE-32 done: the liquidator bot watches every borrower in our markets from the indexed Morpho events and liquidates through `Liquidator` with a KyberSwap route, never using the contract's float. Long and short liquidations ran on the fork. For Wangsit: `Deploy.s.sol` gives one `KEEPER` address both the router and the Liquidator keeper role, while BE-55 asks for one key per role.
- Dharu: BE-04 done: the keeper measures the DEX mid price every 10 minutes and the depth table daily (`dex_quotes`), `/v1/markets` and the stream now carry the DEX price, and 05 has a new depth table from one run. The mid price is now two-sided (D-36), which removed a 2% bias against sales. No 429 at 33 requests in 18 seconds; KyberSwap's real limit is not published.
- Nabil: FE-04 wireframes for every screen are in Figma on one page (https://www.figma.com/design/GaE4wHi18JRAhXl1obEpbY), each with a note on its data, states and task. Next: review by Wangsit and Dharu, then the visual design.
- Dharu: BE-13 and BE-06 done: the indexer follows Morpho's events for our markets (from Wangsit's ABI export), positions rebuilt from them equal `Morpho.position` on the fork for router and direct users, and history shows liquidations and direct Morpho actions. New history type `borrow`.

- Dharu: `/v1/status` written (BE-15): oracle age per stock, keeper health, indexer lag. Backend CI now runs package tests one at a time, since they share one test database.
- Dharu: BE-17 written: the oracle age poster keeper posts `maxOracleAge` from the BE-03 data inside the owner's bounds (D-31). On a fork it moved all five markets; on the real data it proposes QQQ 2,100 s, HOOD 2,160 s and BIL 3,060 s, the same as the deployment values, so it posts nothing today. Team alerts wait for BE-50. Also fixed: keeper and indexer tests no longer clear each other's cursor (PR 18).
- Nabil: repo access works. FE-03 done: `/markets` shows live prices and sessions from the Anchored oracle. FE-01 and FE-02 built on `fe/FE-01-03-m0-foundation`: Next.js app, CI, Privy sign-in, switch to Monad, balances. FE-02 done: sign-in by email, passkey and external wallet works on localhost, with an embedded wallet, real balances and key export. Fixed on the way: export used the active wallet address instead of the embedded one. Next: hosting (blocker), then FE-10 and FE-11. Later: the Vercel import from Nabil's account failed on the private repo, so Wangsit set it up. The app is live at `https://levra-mon.vercel.app` and sign-in works there. Vercel posts a preview address on every PR (seen on PR 25), so FE-01 is done.
- Dharu: BE-14 done and BE-13 started: `apps/indexer` follows router events into Postgres (Envio HyperSync, RPC as fallback, D-34), and `/v1/accounts` and `/history` serve positions from `Lens` with entry price and PnL from the indexed events. Checked end to end on the fork. Waiting: a HyperSync token (Dharu) and Morpho's events in the ABI export (Wangsit). After Wangsit's PR 13 and 14: `DebtRepaid` is indexed, `repay` is a collateral quote action and `repayDebt` a history type; our decisions are renumbered to D-33 (db package) and D-34 (indexer) because D-31 and D-32 were taken.

- Dharu: BE-16 formulas in `packages/shared/math.ts` (PR 10) match `Lens` exactly for a real long and short on the fork. BE-10 and BE-11 (chain reader, `/v1/config`, `/v1/session`, `/v1/markets`, `/v1/stream`) are written and checked against direct contract reads on the fork. Next: BE-12 quote for long.
- Dharu: BE-12 done on the fork: open long with first-use signatures in one `multicall`, reduce, remove collateral and full close, all from quotes over the live KyberSwap route. The router held no USDC afterwards. Request for Wangsit: add `IERC20Permit` (`nonces`, `name`, `version`) to the ABI export; the API uses a minimal fragment until then. Next: BE-06 and BE-13 indexer, then BE-14 accounts.

- Dharu: BE-01 done (PR 7): api with `/v1/health`, keeper job runner with heartbeats, `packages/db`, local Postgres, backend CI passing on GitHub.
- Dharu: BE-03 done: the oracle logger backfilled two weeks of `PriceUpdated` logs and keeps following them. Report in `docs/reports/oracle-2026-10-13.md`. For Wangsit (Q-28): BIL's source quote reached 81.5 minutes after hours, above the 1 hour hard age in `SessionOracle`; nothing is written while `CLOSED`, so `publishedAt` stops too; the session flips for about 15 minutes every Friday at 20:00 ET. Needs PR 8 (event ABI) reviewed by Wangsit.

- Dharu: backend plan adjusted so values that wait on oracle data are picked up without code changes: BE-03 becomes a persistent logger in Postgres with generated reports, BE-10 reads `maxOracleAge` and `stale` from the chain, BE-16 checks bid and ask on every read with the same condition as `SessionOracle`.
- Dharu: keeper plan adjusted the same way: new BE-17 posts `maxOracleAge` from data within multisig bounds, on the source quote clock of D-23 (needs Q-27 from Wangsit); BE-30 and BE-50 take the schedule and limits from BE-03 data; BE-31 and BE-33 use the BE-30 calendar; BE-55 covers the new key.
- Wangsit: SC-03 written and in review: Solidity interfaces, events, errors, ABI export to `packages/shared/abis/`. SC-01 partly done along the way.
- All: interface decisions made together: backend builds transactions (D-19), one confirmation on first use (D-20), backend stack (D-21), Privy for sign-in (D-22). Doc 03 updated to match. The full freeze (X-04) still needs SC-03 and BE-02.
- Wangsit: X-01 started. Private repo created at `github.com/wngstnr-code/levra` with the monorepo root. Collaborators, `CODEOWNERS` and branch protection are still open.
- All: decided together: name Levra (D-15), sign-in by email or passkey in scope (D-16), private repo under `wngstnr-code` (D-17), scope and split of work approved (D-18).
- All: development docs written. Nothing is built yet. Next: X-01, SC-01, SC-03, BE-01, BE-02, BE-03, FE-01 to FE-04.
- Early findings from quick read-only checks (not a replacement for the spikes):
  - Q-17: Anvil 1.8.3 forks Monad mainnet through `rpc2.monad.xyz`. Chain ID 143, the Anchored oracle and Morpho are readable, and an impersonated `approve` on USDC succeeds. A full swap and Morpho flow on the fork is not tested yet (SC-02).
  - Q-19: for QQQ in the OVERNIGHT session, best bid and best ask were both filled and sensible (740.03 and 741.17 around a price of 740.60). One sample only (BE-03).
  - Q-18: USDC reports `version()` = "2" and has `nonces(address)`, so `permit` is likely supported. `DOMAIN_SEPARATOR()` timed out on the public RPC, so this is not confirmed (SC-05).
  - SC-06: Morpho holds about 10.5 million idle USDC, so flash loan room is far above what we need.
- All: interface agreement frozen. PR 1 (contract interfaces and ABIs) and PR 2 (API schemas) are merged. SC-03, BE-02 and X-04 are done.
- Findings from read-only checks and from Anchored's documentation, all written into 05:
  - Tokens: stock tokens are beacon proxies behind a compliance contract with a denylist. Morpho is not on it. They have no `permit`. USDC has `permit` (Q-18 answered).
  - Pools: all three pair directly with USDC, one hop (Q-16 answered). KyberSwap builds calldata for a contract sender and recipient.
  - Oracle: 10 minute heartbeat, about 15 minutes of quote delay, price carried forward while closed, freshness should use `feedUpdateTimestamp`. This opens Q-22.
  - Sessions: weekly close Friday 8:00 PM and weekly open Sunday 8:00 PM, US Eastern Time.
  - Addresses: both Morpho vault factories, the public allocator, Permit2, Multicall3 and Safe 1.4.1 exist on Monad.
  - Cross-chain: price-only quotes into Monad work from Base, Arbitrum and Ethereum, about 0.22% cost and under a minute.
  - Eligibility: Anchored's prohibited list is longer than "United States and China". This opens Q-24.
- New documents: `docs/10-screens.md` (screen draft for FE-04), `docs/outreach/anchored-questions.md` (X-12 draft, not sent), `docs/drafts/risk-disclosure.md` (X-11 draft, not reviewed).
- No product code was written in this round, by the team's choice. Spikes that need code or funds are still open.
- All: decisions D-23 to D-30 taken. Levra will be submitted to Monad Metropolis (D-30). Sprint order: real long on aQQQ, positions and close, cross-chain deposit, short, sign-in by email. Deadline 14 October 2026 at 10:59 WIB.
- Wangsit: contracts written on `sprint/long-flow`: `SessionOracle`, `RiskManager`, `MarginRouter` (long, short, close, auto-deleverage, one confirmation with signatures) and `Lens`. 48 tests pass on a fork of Monad with real Morpho, the real Anchored oracle and real tokens.
- Wangsit: `script/Deploy.s.sol` deploys everything and creates five markets. On a local fork, `script/e2e-long.sh` opened and closed a long on aQQQ through the live KyberSwap route and the router ended with no tokens. Nothing is deployed on mainnet yet. That needs a funded deployer wallet (X-03).
- Backend and frontend for the sprint are not started. They belong to Dharu and Nabil.
- Wangsit: PR 4 opened for the contracts. SC-06 done: the missing addresses are in `packages/shared/addresses.ts`. SC-14: `packages/shared` now validates and reads the deployment file and exposes the stock list in `markets.ts`.
- Wangsit: PR 5 opened with the CI workflow, 8 security tests (reentrancy and signature replay) and one test that walks a full weekend. 57 tests pass. SC-05 done. The aQQQ and aHOOD pools have no hook and charge a 0.90% fee per swap.
- Wangsit: CI is green on PR 5 (SC-01 done). On a local fork, short and auto-deleverage both ran through the live KyberSwap route (`e2e-short.sh`, `e2e-protection.sh`). Two things the backend must know: KyberSwap's calldata enforces its own minimum return from the `slippageTolerance` sent when building it, and KyberSwap refuses some sender addresses.
- Wangsit: SC-23 written. The USDC vault is created from Morpho's MetaMorpho v1.1 factory by `script/DeployVault.s.sol` and tested on a fork. 63 contract tests pass.
- Wangsit: SC-32 written. `Liquidator` liquidates long and short positions with no capital of its own and is deployed by the deployment script. 70 contract tests pass and CI is green.
- Wangsit: SC-50, SC-51 and SC-55 written. Invariant campaign on a fork, Slither clean after review, gas numbers recorded, and a handover of ownership to a timelock behind the multisig. Tests now fork a pinned block, which made them repeatable and fast. 75 tests plus the invariant campaign pass.
- Wangsit: Q-27 answered yes (D-31) and implemented: the oracle age poster moves `maxOracleAge` inside owner-set bounds, which unblocks BE-17. `repayDebt` added to the router (D-32). 84 contract tests pass. Dharu: the API needs a way to quote and record `repayDebt`. Nabil: this is the "add margin" action for a long.
- Wangsit: reviewed the shared formulas and the long quote math (BE-16, BE-12) against the contracts: they match. Dharu's fork tests pass against a fresh fork deployment, including "shared formulas match Lens". Two notes for Dharu: `liquidationPriceE8` for a long still mirrors the old `Lens` rounding (same result in practice, PR 13 changed the contract to divide by `collateral * lltv`), and `maxLtv` is set to the worst case with no headroom, so interest accrued between quote and execution on an existing position could trip `UserLimitExceeded` when the fill lands exactly on the minimum.
- Wangsit: Q-28 proposed and implemented as D-35 (per-market hard oracle ages), waiting for confirmation. Liquidation ran through the live route on a fork. Oracle fuzz tests, Slither in CI, the vault in the ownership handover. 91 contract tests pass.
- Wangsit: the first mainnet run is scripted and rehearsed on a fork with 8 USDC (`make deploy-monad`, `make first-long-monad CONFIRM=yes`). The invariant campaign now includes keeper reductions that succeed.
- Wangsit: `morphoAbi` in `packages/shared/abis/` now includes Morpho's events, which unblocks the indexer and the liquidator bot for users who use Morpho directly. A test decodes a real `Repay` log from Monad with it.
- Wangsit: the first short on mainnet and the seed inventory of SC-24 are scripted (`make first-short-monad CONFIRM=yes`). Long then short were rehearsed on a fork with a 16 USDC wallet: both opened and closed, and the router ended empty.
- Wangsit: the first mainnet run now covers every market in scope (`make first-run-monad CONFIRM=yes`): long on QQQ, HOOD and BIL, short on QQQ and HOOD. Rehearsed on a fork with a 20 USDC wallet. Two findings for Dharu: a close ran out of gas when sent with the bare gas estimate, so a 15% margin on `gasLimit` may be too small for the router's nested calls (the scripts use 50%); and the buy-back of a HOOD short must be sized from the exchange quote, because aHOOD trades above its oracle price.
- Wangsit: rehearsed the first mainnet run with a wallet holding exactly 10 USDC. At half size all five markets open and close. At the default sizes it stops safely after two longs. The command is in `contracts/README.md`.
