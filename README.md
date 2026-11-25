<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/levra-logo-on-dark.svg">
  <img src="docs/assets/levra-logo-on-light.svg" alt="Levra" width="280">
</picture>

### Trade tokenized stocks with leverage, with limits that respect market hours.

Long, short and earn on tokenized stocks from one account, on Monad, Base and X Layer.

[![Privy Bounty Winner](https://img.shields.io/badge/%F0%9F%8F%86_Privy_Bounty_Winner-Monad_Metropolis_2026-FFD700)](https://monad.xyz/metropolis)
[![CI](https://github.com/wngstnr-code/levra/actions/workflows/ci.yml/badge.svg)](https://github.com/wngstnr-code/levra/actions/workflows/ci.yml)
![Chains](https://img.shields.io/badge/chains-Monad%20%7C%20Base%20%7C%20X%20Layer-836ef9)
![Built on Morpho](https://img.shields.io/badge/lending-Morpho-2470ff)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

**[Launch app](https://app.levra.finance)** · **[Live status](https://api.levra.finance/status)** · **[Docs](docs/README.md)** · **[Contracts](docs/public/contracts.md)**

</div>

---

## Overview

Levra is a margin account for tokenized stocks. With one account you can:

- **Go long**: buy a stock token with up to a few times your money.
- **Go short**: profit when the price falls.
- **Earn**: lend USDC or stock tokens to traders and collect interest.

Levra does not run its own exchange or lending pool. Lending and borrowing happen on [Morpho](https://morpho.org), trades go through established DEX routers, and your position always sits under your own address. Each trade is one confirmation.

> 🏆 **Privy Bounty Winner** at [Monad Metropolis 2026](https://monad.xyz/metropolis), Monad's global online hackathon.

## The problem

**The stock exchange closes. The token does not.**

Tokenized stocks trade around the clock onchain, but their real price only moves while the US market is open. A leveraged position that looks safe on Friday evening can open far past its liquidation price on Monday morning, and nobody can react over the weekend. Most lending markets treat a stock token like any other crypto asset and ignore this gap.

## Our solution

Levra is built around the market calendar.

| Feature | What it means for you |
|---|---|
| **Limits that follow market hours** | Each market has a soft limit for new positions that tightens before the close and over weekends, on top of Morpho's hard liquidation limit. |
| **Weekend gap scenarios** | Every quote and position shows your loan-to-value after the worst historical weekend and holiday gaps of that stock. |
| **Opt-in protection** | You can let a keeper reduce your position before the close if it gets too risky. Off by default, per market. |
| **Issuer prices only for liquidation** | The hard limit uses the stock issuer's official price feed. DEX prices are used only for soft checks, so a pushed DEX price cannot liquidate anyone. |
| **Your funds stay yours** | Collateral and debt live in your own Morpho position. Our contracts hold nothing between transactions and none is upgradeable. |
| **Always able to exit** | Closing, reducing, repaying and adding collateral can never be paused, and still work directly on Morpho if our app is down. |

## How it works

### System overview

```mermaid
flowchart TB
    subgraph Client["👤 User"]
        WEB["Web app<br/>Next.js, Privy sign-in"]
    end

    subgraph OffChain["⚙️ Levra backend"]
        API["API<br/>quotes, positions, alerts"]
        IDX["Indexers<br/>one per chain"]
        KEEP["Keepers<br/>calendar, protector, liquidator"]
        DB[("Postgres")]
    end

    subgraph OnChain["⛓️ Levra contracts on Monad, Base, X Layer"]
        ROUTER["MarginRouter"]
        RISK["RiskManager"]
        LIQ["Liquidator"]
        ORACLE["Session oracle"]
    end

    subgraph External["🌐 Protocols Levra builds on"]
        MORPHO["Morpho<br/>lending"]
        DEX["DEX routers<br/>KyberSwap, 1inch, Aero, OKX DEX, Uniswap"]
        FEED["Issuer price feeds<br/>Anchored, Chainlink, xStocks"]
        TAPE["TapeOut circuits<br/>X Layer"]
    end

    WEB -->|one signed transaction| ROUTER
    WEB --> API
    API --> DB
    IDX --> DB
    ROUTER --> MORPHO
    ROUTER --> DEX
    ROUTER --> RISK
    RISK --> ORACLE --> FEED
    MORPHO --> ORACLE
    KEEP --> ROUTER
    KEEP --> RISK
    KEEP --> LIQ --> MORPHO
    API -.second opinion.-> TAPE
```

### Opening a long in one transaction

```mermaid
sequenceDiagram
    actor U as User
    participant R as MarginRouter
    participant M as Morpho
    participant D as DEX router
    participant K as RiskManager

    U->>R: open long (margin, leverage)
    R->>M: flash loan USDC
    R->>D: buy the stock token
    R->>M: supply it as collateral in the user's own position
    R->>M: borrow USDC against it
    R->>M: repay the flash loan
    R->>K: check soft limit and position cap
    K-->>R: ok, or the whole transaction reverts
    R-->>U: position open, router holds no tokens
```

A short works the same way in reverse: the router supplies the user's USDC as collateral, borrows the stock and sells it, also in one transaction.

### Who controls what

```mermaid
flowchart LR
    SAFE["Team Safe<br/>2 of 3 signers"] -->|propose, then wait 2 days| TL["Timelock"]
    TL -->|owner| C["MarginRouter, RiskManager,<br/>Liquidator"]
    SAFE -->|guardian: tighten limits or<br/>pause new positions only| C
    USER["User"] -->|owns the position,<br/>can always close| MORPHO["Morpho"]
    C -. cannot move user funds .-> MORPHO
```

- Every setting change needs 2 of 3 team signatures and then waits 2 days in a timelock, so users see it before it applies. The deployer holds no role.
- The router acts on a position only with the user's Morpho authorization, which the user can revoke at any time.
- If our app and backend go down, a position can still be closed directly on Morpho. The steps are in [docs/public/contracts.md](docs/public/contracts.md).

## Supported chains and markets

| | Monad | Base | X Layer |
|---|---|---|---|
| Stocks | QQQ, HOOD, BIL | AAPL, AMZN, GOOGL, META, MSFT, NVDA, SPCX, TSLA | GOOGL, NVDA, QQQ, SPY |
| Markets | 5 (3 long, 2 short) | 16 (long and short) | 8 (long and short) |
| Stock tokens | Anchored | Coinbase (B20) | xStocks |
| Liquidation price | Anchored oracle | Chainlink, Coinbase feeds | xStocks price feeds |
| Swaps | KyberSwap | 1inch, KyberSwap, Aero | OKX DEX, Uniswap v3 |
| Lending | Morpho, MetaMorpho USDC vault | Morpho, MetaMorpho USDC vault | Morpho, direct market supply |
| Status | Live since 13 October 2026. New positions wait while Anchored's price feed is down (since 19 November 2026); closing still works | Deployed 22 November 2026, first positions next | Deployed 22 November 2026, first positions next |

## Security and trust

| | Status |
|---|---|
| Custody | Non-custodial. Funds stay in the user's own Morpho position |
| Upgradeability | None of our contracts is upgradeable |
| Governance | Team Safe (2 of 3) behind a 2 day timelock on all three chains, since 25 November 2026 |
| Exit | Close, reduce, repay and add collateral can never be paused |
| Liquidation price | Issuer's official oracle only, never a DEX price |
| Testing | Foundry unit, fork and fuzz tests, an invariant campaign and Slither, all in CI on every pull request |
| Source verification | Every contract verified on Sourcify, and on Basescan for Base |
| External audit | **Not done yet** |
| Bug bounty | Drafted, not published yet |

Levra is experimental software. Every risk limit in [docs/04-risk-rules.md](docs/04-risk-rules.md) is an initial proposal, not a tested or safe value. Read the [risk disclosure](docs/drafts/risk-disclosure.md) before using it.

## Deployments

All contracts are on mainnet. The full list of markets, Morpho IDs and oracles is in [`contracts/deployments/`](contracts/deployments/), and roles and limits are in [docs/public/contracts.md](docs/public/contracts.md).

<details>
<summary><b>Monad mainnet (chain 143)</b></summary>

| Contract | Address |
|---|---|
| `MarginRouter` | [`0xf5585feA7aeDC5e148201052f73139111810aA88`](https://monadscan.com/address/0xf5585feA7aeDC5e148201052f73139111810aA88) |
| Previous `MarginRouter` (13 October 2026, still works) | [`0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6`](https://monadscan.com/address/0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6) |
| `RiskManager` | [`0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F`](https://monadscan.com/address/0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F) |
| `Lens` | [`0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7`](https://monadscan.com/address/0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7) |
| `Liquidator` | [`0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39`](https://monadscan.com/address/0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39) |
| USDC vault `Levra USDC` (`lvUSDC`) | [`0xfB99A7E3f5571baA363d67F7823bb354cfd95447`](https://monadscan.com/address/0xfB99A7E3f5571baA363d67F7823bb354cfd95447) |
| `TimelockController` | [`0xf1F6C17660Fa513A42565746a73C654886bd14Dd`](https://monadscan.com/address/0xf1F6C17660Fa513A42565746a73C654886bd14Dd) |

| Stock | Side | Liquidation LTV (Morpho) |
|---|---|---|
| QQQ | long | 77% |
| HOOD | long | 62.5% |
| BIL | long | 91.5% |
| QQQ | short | 77% |
| HOOD | short | 62.5% |

</details>

<details>
<summary><b>Base (chain 8453) and X Layer (chain 196)</b></summary>

The core contracts have the same address on both chains.

| Contract | Address | Base | X Layer |
|---|---|---|---|
| `MarginRouter` | `0xf5585feA7aeDC5e148201052f73139111810aA88` | [Basescan](https://basescan.org/address/0xf5585feA7aeDC5e148201052f73139111810aA88) | [OKX](https://web3.okx.com/explorer/x-layer/address/0xf5585feA7aeDC5e148201052f73139111810aA88) |
| `RiskManager` | `0x8354ff472d87C942f9186acc83e0600424272594` | [Basescan](https://basescan.org/address/0x8354ff472d87C942f9186acc83e0600424272594) | [OKX](https://web3.okx.com/explorer/x-layer/address/0x8354ff472d87C942f9186acc83e0600424272594) |
| `Lens` | `0xa8d15000992Cd055E7731E884D91b16F2123A327` | [Basescan](https://basescan.org/address/0xa8d15000992Cd055E7731E884D91b16F2123A327) | [OKX](https://web3.okx.com/explorer/x-layer/address/0xa8d15000992Cd055E7731E884D91b16F2123A327) |
| `Liquidator` | `0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7` | [Basescan](https://basescan.org/address/0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7) | [OKX](https://web3.okx.com/explorer/x-layer/address/0x92Da4B8c28FE980aAd902b0824aef5D90d6BCBF7) |
| USDC vault `Levra USDC` (`lvUSDC`) | `0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8` | [Basescan](https://basescan.org/address/0x58e732287C17922E9f071d09bC0D5bf5Dd7285b8) | none, Morpho has no vault factory on X Layer |
| `TimelockController` | Base `0xA0089B68a8CFf4d810985DF8503815b3d1344c67`, X Layer `0xce171c460929433640f58dC5d3e9746Db00b420e` | [Basescan](https://basescan.org/address/0xA0089B68a8CFf4d810985DF8503815b3d1344c67) | [OKX](https://web3.okx.com/explorer/x-layer/address/0xce171c460929433640f58dC5d3e9746Db00b420e) |

</details>

<details>
<summary><b>TapeOut circuits on X Layer</b></summary>

Levra's TapeOut processor [`0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c`](https://web3.okx.com/explorer/x-layer/address/0x4D5Bf68e1362046B0281b9bA678345b7FD2aAa5c) holds three circuits any app can read with `eval`:

| ID | Circuit | What it answers |
|---|---|---|
| 1 | Wall Street Clock | The US market session for any moment from 2026 to 2030, with holidays, early closes and daylight saving |
| 2 | Risk, 77% hard limit | Healthy, and under each soft limit, for GOOGL, QQQ and SPY positions |
| 3 | Risk, 62.5% hard limit | The same for NVDA positions |

Each circuit's netlist onchain was checked byte for byte against the code that builds it, and 136 onchain `eval` calls matched our TypeScript math and Morpho's own health rule. Circuits are a second opinion only: no Levra contract reads them.

</details>

## Onchain proof

A selection of real transactions on Monad mainnet. The full list is in [docs/PROGRESS.md](docs/PROGRESS.md).

| What | Transaction |
|---|---|
| Open a QQQ long through the router | [`0x12ae7b11…ff469`](https://monadscan.com/tx/0x12ae7b1179c7f16b89164d2a84bc34d18156278b3117528add662f2d21fff469) |
| Close the QQQ long in full | [`0xff7649bd…f8025`](https://monadscan.com/tx/0xff7649bdd4624b6729738e6fa6ae2a7b1a6b46d6e85fe5a2bd21b3d59eaf8025) |
| Open a QQQ short through the router | [`0x9e45649e…38a06`](https://monadscan.com/tx/0x9e45649e144c5087f49e500bc5c5aab0e6da4bb51d2dce6ab661fe6b27a38a06) |
| Close the QQQ short in full | [`0x1b5c95c2…782ee`](https://monadscan.com/tx/0x1b5c95c28d3b96a82e66b473e65c508c80f8ddab432f9f8495797e2ea41782ee) |
| Open a HOOD short through the router | [`0x44e4302b…2946d`](https://monadscan.com/tx/0x44e4302b500827dba704324168ef3eab7c59f5aa0b9e5ee6a7f0b9f4d882946d) |
| Deposit 1 USDC into the USDC vault | [`0x6233049c…c7817a`](https://monadscan.com/tx/0x6233049c3bbede60e67b0863a3389014dc1243dd795e85f9a18e234513c7817a) |
| Redeem all vault shares, 1 USDC back in full | [`0xa52645ee…da4b689`](https://monadscan.com/tx/0xa52645ee0a4d62838641791419e89b7bc8d5fb740a2207c88762de86b8eda689) |
| First keeper transaction: the calendar poster sets the next close | [`0xc2047d91…c241199`](https://monadscan.com/tx/0xc2047d91042f4a88ed234c923810897fff91241af3a86c452ad2cd048c241199) |
| Deploy `MarginRouter` | [`0x3f36c52b…feb7d`](https://monadscan.com/tx/0x3f36c52b3b4c24979a4d288c84889a1824c6be7de4178c26c4b6f62d057feb7d) |

## Hackathon submissions

<details>
<summary><b>Base: Stocks Maxxing</b></summary>

- 16 Morpho markets, long and short, over the 8 Coinbase stock tokens (B20) on Base.
- The liquidation price comes from Chainlink's Coinbase feeds, read through a session-aware oracle that knows when the US market is open.
- Swaps through 1inch, KyberSwap and Aero, with a fixed allowlist of routers set at deployment.
- A MetaMorpho USDC vault, so lenders earn from every long market with one deposit.
- The keeper watches the stock tokens' own controls (pauses, policy checks) on every market.
- Owned by the team Safe behind a 2 day timelock.

</details>

<details>
<summary><b>X Layer: TapeOut Accelerate</b></summary>

- 8 Morpho markets, long and short, over the wrapped xStocks, priced by the xStocks feeds.
- Swaps through the OKX DEX router and Uniswap v3.
- TapeOut is part of the product, not an add-on: three circuits are live on X Layer mainnet, the Wall Street Clock for the market session and two risk circuits that check a position as a second opinion next to our own math. They are being wired into the X Layer calendar, the trade confirmation (a check after the worst weekend gap) and private receipts through TapeSend. Details in the TapeOut section under [Deployments](#deployments).
- Owned by the team Safe behind a 2 day timelock.

</details>

## Tech stack

| Layer | Tools |
|---|---|
| Smart contracts | Solidity 0.8.28, Foundry, OpenZeppelin, Morpho Blue |
| Backend | Node.js 24, TypeScript, Hono, Drizzle, Postgres, viem |
| Web app | Next.js, React, Tailwind, Privy, wagmi |
| Integrations | Morpho, Chainlink, Anchored, xStocks, KyberSwap, 1inch, Aero, OKX DEX, Uniswap, Circle CCTP, TapeOut |
| Ops | GitHub Actions, Vercel, a VPS with Docker Compose, Safe multisig |

## Getting started

Requirements: Node.js 24 or later, pnpm 10, Foundry, and Docker for Postgres.

The protocols Levra uses exist only on mainnet, so there is no testnet. Local development runs against a fork of Monad mainnet on your own machine, with real Morpho, real oracles and real tokens, and no real money.

```bash
pnpm install

# 1. A local fork of Monad mainnet with our contracts deployed (writes contracts/deployments/fork.json)
cd contracts
make build
make fork            # keep running; port 8545
make deploy-fork     # in a second terminal
cd ..

# 2. Postgres on port 5442, then the schema
docker compose up -d
DATABASE_URL=postgres://levra:levra@localhost:5442/levra pnpm --filter @levra/db migrate

# 3. Backend: copy each .env.example to .env first (the defaults point at the fork and the local database)
pnpm --filter @levra/indexer dev
pnpm --filter @levra/api dev       # http://localhost:8787/v1/health
pnpm --filter @levra/keeper dev    # jobs that need a key stay off until their key is set

# 4. Web app: set NEXT_PUBLIC_API_URL=http://localhost:8787 in apps/web/.env
pnpm --filter @levra/web dev       # http://localhost:3000
```

To read the live mainnet deployment instead of a fork, set `MONAD_RPC_URL=https://rpc2.monad.xyz` and `DEPLOYMENT_FILE=../../contracts/deployments/monad.json` in the backend `.env` files. Every variable is explained in the `.env.example` next to it and in [docs/03-interfaces.md](docs/03-interfaces.md) section 7. Keys and tokens are never committed.

### Tests

```bash
cd contracts && make test           # contracts against a fork of Monad mainnet
pnpm typecheck                      # every package
pnpm test                           # unit tests for every package
```

Database tests need `TEST_DATABASE_URL` (the docker Postgres). Backend tests that open real positions need `FORK_RPC_URL` and `FORK_DEPLOYMENT_FILE` pointing at a running fork; without them they are skipped. The web app also has Playwright tests (`pnpm --filter @levra/web e2e`). CI runs all of them on every pull request, plus Slither and an invariant campaign for the contracts.

## Repository structure

```
levra/
├── contracts/        Smart contracts, deployment and mainnet scripts (Foundry)
├── apps/
│   ├── web/          Web app (Next.js)
│   ├── api/          HTTP API: markets, quotes with ready-to-sign transactions, accounts, Earn, alerts, status
│   ├── indexer/      Router, Morpho and vault events into Postgres, one process per chain
│   ├── keeper/       Calendar poster, oracle age poster, protector, liquidator bot, alerts, team monitor
│   └── agent/        MCP server for AI agents: reads, quotes and prepared actions, holds no keys
├── packages/
│   ├── shared/       ABIs, addresses, deployment files, formulas and API schemas
│   ├── db/           Database schema and migrations
│   ├── swap/         Swap providers: KyberSwap, 1inch, Aero, OKX DEX
│   ├── cctp/         Circle CCTP client for USDC from other chains
│   ├── intents/      Cross-chain deposits through 1Click
│   └── tapeout/      TapeOut circuits: Wall Street Clock and risk
├── deploy/           Backend hosting: image, Docker Compose, HTTPS, deploy and backup scripts
└── docs/             Product, architecture, interfaces, risk rules, tasks and progress
```

Start with [docs/README.md](docs/README.md). The most useful docs:

- [01-product.md](docs/01-product.md): who it is for and the user flows.
- [02-architecture.md](docs/02-architecture.md): the parts, the steps inside each transaction, who is trusted for what.
- [03-interfaces.md](docs/03-interfaces.md): the agreement between contracts, backend and web app.
- [04-risk-rules.md](docs/04-risk-rules.md): limits, formulas and market-hours rules.
- [public/contracts.md](docs/public/contracts.md): public contract documentation and how to exit without the app.
- [runbook.md](docs/runbook.md): what to do when something goes wrong.

## Roadmap

- [x] Monad mainnet: long, short, Earn and keepers (October 2026)
- [x] Privy Bounty at Monad Metropolis 2026
- [x] Base and X Layer mainnet deployments (November 2026)
- [x] Team multisig and 2 day timelock on all three chains
- [x] TapeOut circuits on X Layer mainnet
- [ ] First real positions on Base and X Layer
- [ ] USDC deposits from other chains through Circle CCTP
- [ ] TapeOut checks and private receipts in the app
- [ ] External audit and a public bug bounty
- [ ] Legal review of the region list and the terms

Progress, blockers and every transaction hash are tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Team

Built by three students at Universitas Gadjah Mada, Indonesia.

| Person | Role |
|---|---|
| Wangsit | Team lead, smart contracts |
| Dharu | Backend, infrastructure and keepers |
| Nabil | Web app and design |

## Use of AI tools

All three team members used Claude Code (Anthropic) while building Levra on Monad, Base and X Layer: to write and refactor code, tests and docs, to review pull requests, to prepare and simulate deployment and multisig steps, to verify contract source on the explorers, and to investigate problems on staging.

The team made every product and design decision and chose every risk limit, and reviewed each change before it was merged. No mainnet transaction was sent without a team member's explicit go for that step, and every ownership change goes through the team's 2 of 3 multisig, signed by the team. Facts in the docs are marked as verified, not verified or initial proposal, and the addresses and transaction hashes in this README were checked against the chain.

## License and disclaimer

Released under the [MIT License](LICENSE).

Levra is experimental and not audited. Nothing here is financial advice. Leverage can lose more than your margin in a fast market, and tokenized stocks carry the risks of their issuers. Use only what you can afford to lose.
