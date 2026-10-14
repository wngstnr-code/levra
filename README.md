# Levra

A margin account for tokenized stocks on Monad. One account to buy tokenized stocks with leverage (long), profit when prices fall (short), or lend assets for interest, with funds that can arrive from any chain.

Levra does not run its own exchange or lending pool. Trades go to Uniswap v4 and Monday Trade through the KyberSwap aggregator. Lending and borrowing happen on Morpho. Cross-chain deposits use Aurora Intents. Stock prices come from the Anchored oracle. User funds stay in the user's own Morpho position.

| | |
|---|---|
| Web app | [levra-mon.vercel.app](https://levra-mon.vercel.app) |
| API | [api-production-c154.up.railway.app](https://api-production-c154.up.railway.app/v1/health) |
| Live status | [api-production-c154.up.railway.app/status](https://api-production-c154.up.railway.app/status) |
| Chain | Monad mainnet (chain ID 143) |

## The problem

The stock exchange closes, the token does not. Tokenized stocks trade around the clock on Monad, but their price only moves for real while the US market is open. A leveraged position that looks safe on Friday evening can open far past its liquidation price on Monday morning, with no chance to react over the weekend.

Levra is built around that gap:

- **Limits that follow the market session.** Each market has a soft limit for new positions that tightens before the market closes, on top of Morpho's hard liquidation limit.
- **Opt-in protection.** A user can let a keeper reduce a position before the close when it is above the soft limit. It is off by default, per user and per market.
- **One price source for liquidation.** The hard limit uses the Anchored oracle only. DEX prices are used only for the soft checks, so a pushed DEX price cannot liquidate anyone.
- **Gap scenarios.** Every quote and position shows what the loan-to-value would be after the historical worst weekend and holiday gaps.

## What works today

Everything below runs on Monad mainnet in **staging**: team money, very small position caps, no audit yet.

- **Long** on QQQ, HOOD and BIL, and **short** on QQQ and HOOD, opened and closed in one confirmation each through the router, with a flash loan from Morpho and a live KyberSwap route.
- **Earn**: a USDC vault (MetaMorpho, from Morpho's own factory) that lends to the three long markets, and stock lending to the short markets.
- **Positions**: collateral, debt, loan-to-value, liquidation price, entry price, and profit and loss, read live from the chain, with full history from our indexer.
- **Price charts** for 1 day, 1 week and 1 month from every oracle update since 29 September 2026, and a live price stream.
- **Keepers** on mainnet: calendar poster (posts the next market close), oracle age poster, protector (auto-deleverage), liquidator bot, user alerts on Telegram, and a team monitor. All four on-chain roles are granted and funded; the first keeper transaction posted the next close on 14 October 2026.
- **Cross-chain deposits and withdrawals** through Aurora Intents (1Click), with an optional MON top-up for gas. Quotes work; a real transfer with funds is not done yet.
- **Sign-in** with email, passkey or an external wallet through Privy, with an embedded wallet for new users.

Not done yet, and stated plainly: the external audit, the handover of ownership to the team multisig behind a timelock, a KyberSwap API key for launch traffic, a paid RPC provider, a real cross-chain transfer, and legal review of the region list and the terms. Every risk limit in [docs/04-risk-rules.md](docs/04-risk-rules.md) is an initial proposal, not a tested or safe value.

Progress, blockers and every transaction hash are tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## How it works

```mermaid
flowchart LR
    U[User] --> WEB[Web app]
    WEB -->|quotes and data| API[API]
    WEB -->|one signed transaction| ROUTER[MarginRouter]
    ROUTER -->|flash loan, collateral, debt| MORPHO[Morpho]
    ROUTER -->|swap| KYBER[KyberSwap to Uniswap v4 and Monday Trade]
    ROUTER --> RISK[RiskManager]
    RISK --> ORACLE[SessionOracle]
    MORPHO --> ORACLE
    ORACLE --> ANCH[Anchored oracle]
    KEEPER[Keepers] --> ROUTER
    KEEPER --> LIQ[Liquidator] --> MORPHO
    KEEPER --> RISK
    API --> DB[(Postgres)]
    IDX[Indexer] --> DB
```

Opening a long in one transaction: the router borrows USDC from Morpho with a free flash loan, adds the user's margin, buys the stock token through KyberSwap, deposits it as collateral in the user's own Morpho position, borrows USDC against it, checks the result against the soft limit and the position cap, and repays the flash loan. A short works the same way in reverse: it supplies the user's USDC as collateral, borrows the stock and sells it, also in one transaction.

Where the funds are:

- Collateral and debt sit under the user's own address on Morpho. The router only acts with the user's Morpho authorization, which the user can revoke at any time.
- Our contracts hold no tokens between transactions. None of them is upgradeable.
- Closing, reducing, repaying and adding collateral can never be paused. The most the team can do is stop new positions.
- If our app and backend go down, a position can still be closed directly on Morpho. The steps are in [docs/public/contracts.md](docs/public/contracts.md).

Services on Monad that Levra builds on: Morpho (lending, flash loans, the vault factory), the Anchored oracle and its stock tokens, KyberSwap with Uniswap v4 and Monday Trade, and Aurora Intents for cross-chain transfers. Sign-in uses Privy. The indexer can read logs from Envio HyperSync and falls back to the RPC endpoint; staging uses the RPC endpoint until it has a HyperSync token.

## Contracts on Monad mainnet

| Contract | Address |
|---|---|
| `MarginRouter` | [`0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6`](https://monadscan.com/address/0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6) |
| `RiskManager` | [`0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F`](https://monadscan.com/address/0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F) |
| `Lens` | [`0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8`](https://monadscan.com/address/0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8) |
| `Liquidator` | [`0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39`](https://monadscan.com/address/0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39) |
| USDC vault `Levra USDC` (`lvUSDC`) | [`0xfB99A7E3f5571baA363d67F7823bb354cfd95447`](https://monadscan.com/address/0xfB99A7E3f5571baA363d67F7823bb354cfd95447) |

Markets on Morpho, each with its own `SessionOracle`:

| Stock | Side | Liquidation LTV (Morpho) |
|---|---|---|
| QQQ | long | 77% |
| HOOD | long | 62.5% |
| BIL | long | 91.5% |
| QQQ | short | 77% |
| HOOD | short | 62.5% |

The source of all nine contracts is verified on Sourcify. Market IDs and the oracle addresses are in [`contracts/deployments/monad.json`](contracts/deployments/monad.json). Roles, what the team can and cannot change, and how to leave without the app are in [docs/public/contracts.md](docs/public/contracts.md).

## Real transactions on Monad

A selection. The full list is in [docs/PROGRESS.md](docs/PROGRESS.md).

| What | Transaction |
|---|---|
| Deploy `MarginRouter` | [`0x3f36c52b…feb7d`](https://monadscan.com/tx/0x3f36c52b3b4c24979a4d288c84889a1824c6be7de4178c26c4b6f62d057feb7d) |
| Open a QQQ long through the router | [`0x12ae7b11…ff469`](https://monadscan.com/tx/0x12ae7b1179c7f16b89164d2a84bc34d18156278b3117528add662f2d21fff469) |
| Close the QQQ long in full | [`0xff7649bd…f8025`](https://monadscan.com/tx/0xff7649bdd4624b6729738e6fa6ae2a7b1a6b46d6e85fe5a2bd21b3d59eaf8025) |
| Open a QQQ short through the router | [`0x9e45649e…38a06`](https://monadscan.com/tx/0x9e45649e144c5087f49e500bc5c5aab0e6da4bb51d2dce6ab661fe6b27a38a06) |
| Close the QQQ short in full | [`0x1b5c95c2…782ee`](https://monadscan.com/tx/0x1b5c95c28d3b96a82e66b473e65c508c80f8ddab432f9f8495797e2ea41782ee) |
| Open a HOOD short through the router | [`0x44e4302b…2946d`](https://monadscan.com/tx/0x44e4302b500827dba704324168ef3eab7c59f5aa0b9e5ee6a7f0b9f4d882946d) |
| Deposit 1 USDC into the USDC vault | [`0x6233049c…c7817a`](https://monadscan.com/tx/0x6233049c3bbede60e67b0863a3389014dc1243dd795e85f9a18e234513c7817a) |
| Redeem all vault shares, 1 USDC back in full | [`0xa52645ee…da4b689`](https://monadscan.com/tx/0xa52645ee0a4d62838641791419e89b7bc8d5fb740a2207c88762de86b8eda689) |
| First keeper transaction: the calendar poster sets the next close | [`0xc2047d91…c241199`](https://monadscan.com/tx/0xc2047d91042f4a88ed234c923810897fff91241af3a86c452ad2cd048c241199) |

## Run it locally

Requirements: Node.js 24 or later, pnpm 10, Foundry, and Docker for Postgres.

The protocols Levra uses exist only on Monad mainnet, so there is no testnet. Local development runs against a fork of mainnet on your own machine, with real Morpho, the real Anchored oracle and real tokens, and no real money.

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

## Tests

```bash
cd contracts && make test           # contracts against a fork of Monad mainnet
pnpm typecheck                      # every package
pnpm test                           # unit tests for every package
```

Database tests need `TEST_DATABASE_URL` (the docker Postgres). Backend tests that open real positions need `FORK_RPC_URL` and `FORK_DEPLOYMENT_FILE` pointing at a running fork; without them they are skipped. The web app also has Playwright tests (`pnpm --filter @levra/web e2e`). CI runs all of them on every pull request, plus Slither and an invariant campaign for the contracts.

## Layout

| Path | Contents | Owner |
|---|---|---|
| `contracts/` | Smart contracts, deployment and mainnet scripts (Foundry) | Wangsit |
| `apps/api/` | HTTP API: markets, quotes with ready-to-sign transactions, accounts, Earn, deposits, alerts, status | Dharu |
| `apps/indexer/` | Follows router, Morpho and vault events into Postgres | Dharu |
| `apps/keeper/` | Calendar poster, oracle age poster, protector, liquidator bot, alerts, oracle logger, team monitor | Dharu |
| `apps/web/` | Web app (Next.js) | Nabil |
| `packages/shared/` | ABIs, addresses, deployment files, formulas and API schemas, shared by everyone | Shared |
| `packages/db/`, `packages/kyber/`, `packages/intents/` | Database schema, KyberSwap client, Aurora Intents client | Dharu |
| `docs/` | Product, architecture, interface agreement, risk rules, tasks and progress | Shared |

## Docs

Start with [docs/README.md](docs/README.md). The most useful ones:

- [01-product.md](docs/01-product.md): who it is for and the seven user flows.
- [02-architecture.md](docs/02-architecture.md): the parts, the order of steps inside each transaction, who is trusted for what.
- [03-interfaces.md](docs/03-interfaces.md): the agreement between contracts, backend and web app.
- [04-risk-rules.md](docs/04-risk-rules.md): limits, formulas and market-hours rules.
- [public/contracts.md](docs/public/contracts.md): public contract documentation.
- [runbook.md](docs/runbook.md): what to do when something goes wrong.

## Team

| Person | Part |
|---|---|
| Wangsit | Smart contracts |
| Dharu | Backend, indexer and keepers |
| Nabil | Web app and design |

## Use of AI tools

All three team members used Claude Code (Anthropic) while building Levra: to write and refactor code, tests and docs, to review changes, and to investigate problems on staging.

The team made every product and design decision and chose every risk limit, reviewed each change before it was merged, and sent every transaction on Monad itself. Facts in the docs are marked as verified, not verified or initial proposal, and the addresses and transaction hashes in this README were checked against the chain.

## License

MIT
