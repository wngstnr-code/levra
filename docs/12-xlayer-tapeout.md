# 12. Levra on X Layer: TapeOut Accelerate

The plan for adding X Layer as Levra's third chain and submitting Levra to OKX's X Layer TapeOut Accelerate (Build X series). Agreed by Wangsit, Dharu and Nabil on 19 November 2026 (D-52 to D-57). It builds on doc 11 (Base). Same codebase, same product rules.

## 1. The final idea in plain words

Levra is one account for tokenized stocks with three uses:

1. **Long**: buy a stock with borrowed money, so a rise pays more.
2. **Short**: profit when a stock falls.
3. **Earn**: lend stocks or USDC and earn interest.

Funds can come from any chain, and they always stay in the user's own Morpho position.

The problem: tokenized stocks now live onchain, but today you can only borrow USDC against them. Nobody lets you short them, holders earn nothing on them, and the stock market closes at night and at weekends while the tokens keep trading, so prices can jump at the open.

What Levra adds: the first shorts for these stocks, one-click longs, Earn for holders (which also supplies the shorts), limits that follow market sessions with opt-in protection before the open, and an agent that prepares actions the user signs.

Pitch line: *"Others let you borrow against stocks. Levra lets you short them, earn on them, and knows when Wall Street is closed, on Monad, Base and X Layer."*

How Levra earns: a small fee on open and close, a share of Earn interest through the vault fee, later premium agent features. Amounts are initial proposals (04).

## 2. One Levra, three chains

| | Monad | Base | X Layer |
|---|---|---|---|
| Chain ID | 143 | 8453 | 196 |
| Stocks | Anchored | Coinbase B20 | xStocks (wrapped, for example wNVDAx) |
| Hard limit oracle | Anchored | Chainlink (Coinbase feeds) | The Chainlink style OCR2 feeds used by the Morpho markets, 24/5 (D-69, owner Q-42) |
| Lending | Morpho | Morpho | Morpho |
| Swap | KyberSwap until BE-71 shows 1inch routes Anchored | 1inch, Aerodrome router as fallback (D-72) | OKX DEX API |
| Cross-chain | CCTP and Across | CCTP and Across | CCTP (Across does not list X Layer) |
| Sign-in | Privy | Privy, Base Account | Privy, OKX Wallet as an external wallet |
| Chain specific | | Builder Codes, Bankr agent | TapeOut risk circuit and PnL proofs |

One codebase. Only the plug-ins per chain differ: stock list, oracle adapter and swap provider (D-53).

## 3. The competition

Read from the official page in a browser on 19 November 2026 (`web3.okx.com/xlayer/build-x-series`).

| Item | Fact |
|---|---|
| Name | X Layer TapeOut Accelerate, part of the Build X series |
| Dates | 16 October to 7 December 2026, 23:59 UTC (8 December, 06:59 WIB) |
| Prizes | 100,000 USDT: first 20,000 (1 team), second 10,000 (5 teams), third 6,000 (5 teams). The pool may grow |
| Judges | X Layer and TapeOut teams |
| Criteria | User value and commercial potential; innovation; ecosystem integration (TapeOut, DeWEB, FabX, TapeCode, TapeKit, TapeSend); product readiness and UX. Weights not stated |
| Must | Build in the TapeOut ecosystem: use TapeOut circuits, contracts or onchain data on X Layer, or run on X Layer DeWEB. Give the addresses used. Apps must give an access link and say which TapeOut features they use |
| Description | Product, target users and how to reach them, revenue model, why users will pay and stay |
| Video | Up to 3 minutes: problem, main features, target users and business model, how TapeOut is used |
| Existing projects | Allowed. Only work done during the event is judged, and it must be described clearly |
| FAQ | Not everything must run in a circuit. No own processor needed. No revenue needed yet |
| Format | Online. Shortlisted teams attend an offline Demo Day |
| Submission | Google Form on the page |

## 4. Facts about X Layer that shape the design

### Morpho markets for xStocks (verified 19 November 2026)

Read from the Morpho API (chain 196) and the X Layer RPC. All markets lend USDC and use `MorphoChainlinkOracleV2`.

| Collateral | LLTV | Supply / borrow (USD) |
|---|---|---|
| wQQQx | 86% | 181K / 91K |
| wNVDAx | 77% | 104K / 71K |
| wCRCLx | 62.5% | 60K / 8K |
| wGOOGLx | 77% | 31K / 15K |
| wSPYx | 86% | 26K / 13K |
| wSPCXx | 62.5% | 8K / 4K |
| wAAPLx, wTSLAx | 77% | under 1K |

- Example feed: `wNVDAx-USD (Calculated)` at `0x761FE3B4C1043862bB0c53F5fAAe19F159F6b303`, 8 decimals. Run by Chainlink (the same Safe owns Chainlink's ETH / USD on X Layer, Q-42), 24/5 with a weekend stop (SC-81, 05).
- Morpho launched on X Layer on 18 November 2026 with up to 350,000 USDC of incentives from OKX Wallet and xStocks (press).
- No market lends stocks yet, so Levra creates the short markets (collateral USDC, loan the stock), as on Base.
- The long markets above cannot be configured in our `RiskManager` (their oracle is not an `ISessionOracle`), as on Base (D-77). Whether X Layer longs use our own markets or a `RiskManager` change is Q-45, because these markets are larger and carry incentives.
- X Layer has no MetaMorpho (Vault V1) factory, only Morpho Vault V2, and every Morpho vault there is a Vault V2 (SC-80). Our Earn vault on Monad and Base is MetaMorpho v1.1 (D-24), so X Layer needs a different vault (Q-44).

### Other services

| Service | Status | Source |
|---|---|---|
| Native USDC and CCTP V2 | Live since 7 August 2026, Fast Transfer supported. USDC `0xB6CEceAB302E2E4948951eE7843FC24E92933061`. Bridged USDC.e still exists | Circle |
| OKX DEX API | Chain 196 supported: quote, swap, approve, broadcast | OKX docs, OKX DEX SDK |
| Uniswap Trading API | Lists X Layer | Uniswap docs |
| 0x | Not listed | 0x docs |
| Across | Not listed | Across |
| 1inch | Not checked (BE-81) | |

The Morpho markets lend native USDC `0xB6CE...3061`, the address on Circle's official list (checked in SC-80). CCTP domain for X Layer: 37.

## 5. TapeOut and how Levra uses it

What TapeOut is (from its proposals repo and posts, not audited):

- Four modules live on X Layer mainnet since 19 September 2026: Processor Factory, Circuit Container, Website Repository (DeWEB) and TapeSend.
- A processor is an ERC-721 collection made through the factory. Each circuit is a token in it that holds logic which can run onchain. Circuit IDs are local to their processor.
- TapeKit is the SDK and lists the X Layer and Base addresses. TapeSend carries messages and commitments.
- Maturity: only TAP-01 (the process) is final. TAP-10 (DeWEB) is a draft. No audit. The Hub and Factory are not sealed, so they can still change.

Rule (D-55): **user funds never pass through TapeOut, and no hard limit depends on it.** TapeOut is used where a wrong or missing answer cannot move money.

What Levra builds on TapeOut:

1. **Risk circuit.** Health factor, liquidation price and the session limit from `packages/shared/math.ts` as a TapeOut circuit. The agent and the stats page call it and show "verified by circuit". The result must match `math.ts` and the contracts exactly; a test compares them (BE-83).
2. **PnL proofs.** When a position closes, Levra posts a commitment of the result (market, side, entry, exit, PnL in percent, transaction hash) through TapeSend. The share card (FE-76) and the leaderboard link to it, so anyone can check the number (BE-84, FE-81).
3. **DeWEB mirror.** The stats page and a light landing page served from X Layer DeWEB (FE-82, required since D-66).
4. **Wall Street Clock circuit.** The market sessions from `calendar.ts` (regular, pre, after, overnight, weekend, holiday) as a circuit any app on X Layer can read. Soft layer only (D-66).
5. **Open risk circuit.** The risk circuit answers for any Morpho xStocks borrower on X Layer, not only Levra users (D-66).
6. **Agent checked by circuits.** The agent checks each action it prepares against circuits 4 and 5 before offering it. The user still signs, and the contracts check again. If time allows (D-66).

Not used: a circuit that triggers auto-deleverage (it touches a path that moves funds) and FabX (D-74). The pitch presents this split as a design choice (D-67).

## 6. Changes to earlier decisions

- D-50 said 0x or 1inch on every chain. D-53 refines it: one aggregator interface in the code, provider chosen per chain. X Layer uses the OKX DEX API.
- D-49 (issuer's official oracle per chain) extends to X Layer: the oracle the Morpho markets use for xStocks, once SC-81 confirms the vendor. If it is not an official feed, the decision comes back to the team.
- CLAUDE.md is updated to name the three chains.

## 7. Task split

Full tasks are in each task file under "X. X Layer (TapeOut Accelerate)".

| Area | Tasks | First to unblock others |
|---|---|---|
| SC, Wangsit | SC-80 to SC-85 | SC-80 (addresses), SC-81 (oracle check) |
| BE, Dharu | BE-80 to BE-87 | BE-81 (OKX DEX spike), BE-82 (TapeOut spike) |
| FE, Nabil | FE-80 to FE-83 | FE-80 (X Layer in the chain picker) |
| Shared | X-35 to X-37 | X-35 (seed funds), X-37 (submission) |

What each side needs from the others:

| Who needs | What | From | Task |
|---|---|---|---|
| BE, FE | X Layer addresses and markets in `packages/shared` | Wangsit | SC-80 |
| SC | OKX DEX router address for the allowlist | Dharu | BE-81 |
| BE | X Layer deployment file | Wangsit | SC-83 |
| FE | TapeOut circuit address and ID, TapeSend format | Dharu | BE-83, BE-84 |
| All | Chain picker shape from FE-70 | Nabil | FE-70 |

Checkpoint I-X1: one real long and one real short on X Layer mainnet through the web app, and one PnL proof readable onchain, with hashes in PROGRESS.

## 8. Sources

- https://web3.okx.com/xlayer/build-x-series (read in a browser)
- Morpho API `https://blue-api.morpho.org/graphql` and RPC `https://rpc.xlayer.tech` (read directly)
- https://www.circle.com/blog/now-available-native-usdc-cctp-on-x-layer
- https://github.com/okx/okx-dex-sdk and https://web3.okx.com/onchainos/dev-docs/home/supported-chain
- https://developers.uniswap.org/docs/trading/swapping-api/supported-chains
- https://docs.0x.org/docs/introduction/supported-chains
- https://github.com/TapeOutProtocol/TAPs/pull/2, https://github.com/TapeUP/TAPs, https://github.com/TapeOutProtocol/TapeKit/pull/10
- https://thedefiant.io/news/defi/morpho-brings-stock-token-loans-to-okx-s-x-layer (press)
