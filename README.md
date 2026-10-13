# Levra

A margin account for tokenized stocks on Monad. One account to buy tokenized stocks with leverage (long), profit when prices fall (short), or lend assets for interest, with funds that can arrive from any chain.

Levra does not run its own exchange or lending pool. Trades go to Uniswap v4 and Monday Trade through the KyberSwap aggregator. Lending and borrowing happen on Morpho. Cross-chain deposits use Aurora Intents. Stock prices come from the Anchored oracle. User funds stay in the user's own Morpho position.

## Status

Design and task breakdown are written. No product code yet. Progress is tracked in [docs/PROGRESS.md](docs/PROGRESS.md).

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
