# Levra

A margin account for tokenized stocks on Monad. One account to buy tokenized stocks with leverage (long), profit when prices fall (short), or lend assets for interest, with funds that can arrive from any chain.

Levra does not run its own exchange or lending pool. Trades go to Uniswap v4 and Monday Trade through the KyberSwap aggregator. Lending and borrowing happen on Morpho. Cross-chain deposits use Aurora Intents. Stock prices come from the Anchored oracle. User funds stay in the user's own Morpho position.

## Status

The contracts are live on Monad mainnet in staging: small position caps, team money, no audit yet. A long on QQQ, HOOD and BIL and a short on QQQ and HOOD have each been opened and closed with real funds. The backend and the web app are being built. Progress, with every transaction hash, is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

## Contracts on Monad mainnet

| Contract | Address |
|---|---|
| `MarginRouter` | `0xa3F19ac30Be34028D9a0CaAcaF00c0b7295Fc2E6` |
| `RiskManager` | `0xe8A2088020Ea61B77e33Df953abcc4004d9FC74F` |
| `Lens` | `0xd3835f7bd58BFBE59Eae6210Bf7257405aF72cb8` |
| `Liquidator` | `0x56d40aCD99F1537f2ecfCD6ba7B1E879F9aaFd39` |

The source is verified on Sourcify. Markets, roles, what the team can and cannot change, and how to leave without the app are in [docs/public/contracts.md](docs/public/contracts.md).

## Docs

Start with [docs/README.md](docs/README.md).

## Layout

| Path | Contents | Owner |
|---|---|---|
| `contracts/` | Smart contracts (Foundry) | Wangsit |
| `apps/api/`, `apps/indexer/`, `apps/keeper/` | Backend, indexer and keepers | Dharu |
| `apps/web/` | Web app | Nabil |
| `packages/shared/` | ABIs, addresses, formulas and API schemas | Shared |
| `docs/` | Design, interface agreement, tasks and progress | Shared |

Folders appear as their first task lands.

## Requirements

Node.js 24 or later, pnpm 10, and Foundry.

## License

MIT
