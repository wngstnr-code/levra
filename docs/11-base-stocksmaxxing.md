# 11. Levra on Base: Stocks Maxxing

The plan for bringing Levra to Base and submitting it to Base's Stocks Maxxing competition. Agreed by Wangsit, Dharu and Nabil on 19 November 2026 (D-44 to D-51). It sits on top of docs 01 to 10. Where it changes an earlier rule, the decision in 09 says so.

## 1. The idea in one paragraph

Levra becomes one margin account for tokenized stocks on two chains, Monad and Base, from one codebase. On Base it uses Coinbase's tokenized stocks (B20). Aave and Morpho already let you borrow USDC against those stocks. Nobody on Base lets you **short** them, and nobody pays holders interest for lending them out. Levra adds both, plus one-click leveraged longs, and it knows when the stock market is closed: the Chainlink feed freezes at the Friday close while the tokens keep trading all weekend. A Levra agent lets people do the same things by chat, always with the user's own signature or tightly limited permission.

Pitch line: *"Aave lets you borrow against stocks. Levra lets you short them, and knows when Wall Street is closed."*

## 2. The competition

Source: the official page and rules, read on 19 November 2026. Items marked "press" come from news coverage only.

| Item | Fact |
|---|---|
| Name and host | Stocks Maxxing, run by Base (Coinbase Technologies, Inc.) |
| Dates | 5 November to 5 December 2026. Submit by **5 December 2026** |
| Prizes | $100,000+ in USDC on Base. Pool per track plus partner prizes. $6,000 build in public award (press) |
| Our track | **Programmable Stock Markets** only (D-61, replaces the track part of D-46). One prize per project. The agent is a product feature |
| Judging | 50% traction (real onchain usage), 25% product quality, 25% build in public (press). The rules only say equal weights unless the quest page says otherwise. Not verified |
| Submission | A public X post with a video demo that tags @buildonbase, plus the submission form with the post link and tracks. Must be built on or meaningfully integrate with Base |
| Earlier code | Allowed if the form says clearly what was built during the quest period. We mark the line with the tag `pre-base` on the last `main` commit before this work |
| Eligibility | 18+, not in an OFAC sanctioned region, teams up to 5. Manipulating traction gets a team disqualified |
| Partners | o1 Exchange, Bankr, Stonks Exchange, BaseStonk, Feel.cash, Hydropump (Hydrex), each with a Telegram group |
| Resources | Tokenized Stocks API, integration guide, Builder Codes, Builder Stack credits |
| Earlier editions | None. This is the first one |

## 3. What we ship on Base

All three products, same flows as 01 (D-45):

| Product | On Base | Lending side |
|---|---|---|
| Long | Borrow USDC against a Coinbase stock in one confirmation | **New Morpho markets created by Levra** with our `ChainlinkSessionOracle`, fed by the Levra USDC vault (D-77). The existing Coinbase stock markets (8 stocks, LLTV 62.5%, Alphabet also 77%, 05) cannot be configured in our `RiskManager` and stay a yield option for the vault |
| Short | Borrow the stock against USDC, sell it, buy back to close | **New Morpho markets created by Levra**: collateral USDC, loan the stock |
| Earn | Lend stocks (feeds the short markets) or USDC (feeds longs) | Levra vaults on Morpho, same model as SC-23 |

The team seeds a small amount of each stock into the short markets so shorts work from day one (D-47). Size: about $100 per listed stock plus $200 USDC in the vault, initial proposal (D-70).

Markets at launch: the Coinbase stocks that have both a Morpho long market and a Chainlink feed. SC-70 found 8 on 19 November 2026: AAPLc, AMZNc, GOOGLc, METAc, MSFTc, NVDAc, SPCXc and TSLAc (05, Base). The final list also needs the policy check in SC-71.

### Agent

A Levra agent that can:

- answer "what is my position, my health, my liquidation price";
- quote and prepare long, short, close and add-collateral actions, which the user signs;
- watch positions and warn before the market opens or when health falls, and offer a one-tap fix;
- run inside Bankr (as a skill or integration) and in our Telegram bot from BE-33.

It never holds keys. Every action is either a transaction the user signs, or the existing opt-in auto-deleverage. Delegated trading permission (for example Privy session signers) is a later step, not in this submission (Q-35).

## 4. Stack per chain

Rule: infrastructure that exists on both chains is shared. Assets and liquidity follow the chain (D-48).

| Function | Base | Monad | Change |
|---|---|---|---|
| Sign-in | Privy, plus Base Account through Privy | Privy | Keep, add Base |
| Lending | Morpho | Morpho | Keep |
| Stock tokens | Coinbase B20 | Anchored | Per chain |
| Hard limit oracle | Chainlink (Coinbase B20 feeds) | Anchored | New adapter, same interface (D-49) |
| Swap | 1inch Swap API, Aerodrome router as fallback (D-72) | KyberSwap until 1inch is shown to route Anchored stocks (BE-71) | Add (D-50, D-72) |
| Cross-chain deposit | Circle CCTP and Across | Circle CCTP and Across | Replaces Aurora Intents / 1Click (D-50) |
| Indexer | Envio | Envio | Keep |
| Attribution | Builder Codes on every transaction | none | Add |
| Hosting | One VPS for the backend (D-94) and Vercel for the web app | The same VPS and Vercel | Railway replaced by a VPS on 20 November 2026 |

Verified on 19 November 2026 from official docs: Morpho on Base has Coinbase stock markets; 0x and 1inch support Monad (chain 143) and Base; CCTP supports Monad (domain 15, standard transfer only) and Base; Across lists Monad; Chainlink Data Feeds run on Monad mainnet. Not verified: whether 0x or 1inch route to Anchored tokens on Monad (BE-71).

## 5. Facts about Coinbase stocks that shape the design

From Base Docs (`docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base`) and Chainlink Docs, read on 19 November 2026. These go into 05 under a new Base section (SC-70).

| Topic | Fact | What Levra does |
|---|---|---|
| Standard | B20, an ERC-20 extension, built as a precompile on Base. No per-token contract on Basescan | Treat as ERC-20. Key tokens by address, never by symbol |
| Transfer policy | Each token has a policy (allowlist or blocklist). A blocked transfer reverts. `approve` is not policy gated | Before listing, check `policyExists` and `isAuthorized` for the router, Morpho and the liquidator (SC-71). Monitor it (BE-75) |
| Pause | The issuer can pause some functions | Monitor. A paused token blocks new opens; close paths must still be tried (see 7) |
| KYC | Only for mint and redeem by Authorized Participants. Secondary holding and trading are permissionless | Same region block as D-42, US blocked |
| Multiplier | WAD scaled (1e18). Dividends raise it. Changes are scheduled with `updateUIMultiplier` and `effectiveAt` | All amounts stay raw token units onchain. UI shows share units with `toUIAmount`. Indexer follows `UIMultiplierUpdated` and `UIMultiplierUpdateCancelled` |
| Oracle | Chainlink V3 aggregator, 8 decimals, price = equity price x multiplier | `ChainlinkSessionOracle` adapter (SC-72) |
| Oracle timing | 24/5. Updates on 0.5% deviation or every 24 hours in market hours. Holds the last value when closed, during corporate actions and when paused (`updatedAt` stops) | Session aware max age. Never liquidate on a frozen feed. Soft layer uses the DEX price on weekends |
| Pause flag | Read from Coinbase's oracle registry | Adapter reads it and reports the market as halted |
| Liquidity | Aerodrome has about 76% of Base stock DEX volume. Pools were $0.6M to $1M deep at launch (press) | Small position caps, initial proposal (04) |
| Lending | Morpho long markets exist with little USDC borrowed so far. Aave V4 Equities Hub lends USDC against 7 stocks but stocks cannot be borrowed | Morpho only (D-44). Seed USDC in the Levra vault too |

## 6. How one codebase serves two chains

- `packages/shared` keys everything by chain ID: `addresses.ts`, `markets.ts`, deployments (`deployments.base.ts` next to `deployments.monad.ts`), and a `chains.ts` with chain ID, name, block explorer and native gas token. Monad stays the default until FE ships the chain switch (SC-73, owner Wangsit, with Dharu for `api/`).
- Contracts: `MarginRouter`, `RiskManager`, `Lens` and `Liquidator` stay the same code. Only the oracle and the swap allowlist differ per chain. `SessionOracle` gets a sibling `ChainlinkSessionOracle` behind the same interface (`ISessionOracle`).
- API: every route takes the chain (`/v1/:chainId/...`, decided in BE-70 and written into 03 first). The current routes stay as Monad aliases until FE moves.
- Indexer and keeper: one process per chain, same code, chain from config.
- Web: one app, chain picker in the header, URLs carry the chain (`/base/markets`, `/monad/markets`).
- Session calendar: `calendar.ts` stays the single source. Base needs only the regular, pre, after and overnight sessions it already has, plus "feed frozen" from the adapter.

## 7. Rules that change and rules that do not

Unchanged (CLAUDE.md section 8 still holds):

- User funds stay in the user's own Morpho position.
- Close, reduce and add collateral can never be paused by us.
- Auto-deleverage is opt-in per user and per market.
- All limits are initial proposals.

Changed (D-49): "the hard limit uses the Anchored oracle only" becomes "the hard limit uses the issuer's official oracle only: Anchored on Monad, Chainlink's Coinbase feed on Base. DEX prices only in the soft layer." CLAUDE.md is updated. Doc 04 is updated in the same PR as SC-72.

New risk, written into 04 by Wangsit (SC-74): the issuer can block or pause a token. Then even a close can fail because the token cannot move. We cannot prevent this. We show it in the risk disclosure and the market page, and the keeper alerts users when a policy or pause changes.

## 8. Task split

Full tasks with "Do" and "Done when" are in each task file under "B. Base (Stocks Maxxing)". Summary:

| Area | Tasks | First to unblock others |
|---|---|---|
| SC, Wangsit | SC-70 to SC-78 | SC-70 (Base addresses), SC-73 (chain keyed shared package), SC-72 (oracle adapter ABI) |
| BE, Dharu | BE-70 to BE-79 | BE-70 (API chain routing in 03), BE-71 (1inch quote check, D-72) |
| FE, Nabil | FE-70 to FE-77 | FE-70 (chain picker on the existing pages) |
| Shared | X-30 to X-34 | X-30 (build in public), X-31 (seed funds) |

What each side needs from the others:

| Who needs | What | From | Task |
|---|---|---|---|
| BE, FE | Base addresses and markets in `packages/shared` | Wangsit | SC-70, SC-73 |
| BE | ABI of `ChainlinkSessionOracle` and its events | Wangsit | SC-72 |
| BE | Base deployment file | Wangsit | SC-76 |
| FE | API routes with the chain in them, in 03 | Dharu | BE-70 |
| FE | Quotes on Base | Dharu | BE-72 |
| SC | Chosen aggregator router addresses for the allowlist | Dharu | BE-71 |
| FE, BE | Agent API shape | Dharu | BE-77 |
| All | Seed funds in the team wallet | All | X-31 |

Order that keeps all three busy from day one:

1. Day one, in parallel: SC-70, SC-71, SC-73 (Wangsit); BE-70, BE-71 (Dharu); FE-70, X-30 (Nabil).
2. Then: SC-72, SC-75 and BE-72, BE-73 and FE-71, FE-72.
3. Integration checkpoint I-B1: one real long and one real short on Base mainnet through the web app, with real transaction hashes in PROGRESS.
4. Then: Earn, deposits, agent, traction work.
5. Integration checkpoint I-B2: the submission package (X-34).

## 9. Traction plan (50% of the score, press)

Real users only. Inflating numbers disqualifies the team.

- Builder Codes on every Base transaction (BE-74), so every action is counted for Levra.
- Small minimum position size so people can try with a few dollars (initial proposal in 04).
- Gas sponsored for the first actions with a Base paymaster through Privy (FE-74, Q-34 for budget).
- A public stats page: open interest, number of wallets, volume, all read from the indexer (FE-75).
- Shareable position card for X after open or close (FE-76).
- Posts in the partner Telegram groups and X (X-30, X-32).

## 10. Build in public (25% plus the $6,000 award, press)

Rules are not detailed on the page (Q-33). What we do:

- One X post a day from a team account: what shipped, a screenshot or short clip, real transaction hashes. Tag @buildonbase.
- The daily log in PROGRESS.md is the source for the post, so there is no extra writing.
- Repo made public before submission, or a public mirror, after a secrets check (X-33, Q-32).

## 11. Open items

See Q-32 to Q-36 in 09. The most important: whether the Coinbase policy authorizes our contracts (SC-71), and whether a short market on Morpho with a frozen weekend oracle is safe enough at the sizes we allow (SC-74).

## 12. Sources

- https://www.base.org/stocksmaxxing and https://www.base.org/stocksmaxxing/rules
- https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base
- https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase
- https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- https://docs.monad.xyz/tooling-and-infra/cross-chain
- https://docs.0x.org/docs/introduction/supported-chains
- https://business.1inch.com/whats-new/cronos-monad-hyperevm-support
- https://crypto.news/morpho-adds-usdc-lending-for-five-coinbase-tokenized-stocks/ (press)
- https://cryptobriefing.com/aerodrome-tokenized-stocks-nvidia-meta-apple-google/ (press)
