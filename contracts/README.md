# Contracts

Foundry project for the Levra contracts. Owner: Wangsit.

| Contract | What it does |
|---|---|
| `SessionOracle` | Morpho oracle for one stock market, fed by the Anchored stock oracle. Knows the market session |
| `RiskManager` | Soft limits that follow market hours, position caps, and the pause for opening |
| `MarginRouter` | Opens and closes long and short positions in one transaction through a Morpho flash loan and one swap |
| `Lens` | Reads every market and every position of a user in one call |
| `Liquidator` | Lets our keeper liquidate unhealthy positions with no capital: seize, swap, repay in one call |

The USDC vault is not our code. `script/DeployVault.s.sol` creates it from Morpho's MetaMorpho v1.1 factory and `script/VaultPlan.sol` holds its settings: supply caps per stock, a 10% fee on interest, and a one day timelock.

User funds stay in the user's own Morpho position. The router acts through the Morpho authorization the user grants and holds no tokens between transactions.

## Setup

```bash
git submodule update --init --recursive
make build
```

## Commands

| Command | What it does |
|---|---|
| `make build` | Compile |
| `make test` | Run the tests against a fork of Monad mainnet (real Morpho, real Anchored oracle, real tokens) |
| `make invariants` | Run the invariant campaign: random users, a keeper and a moving price. Takes about five minutes |
| `make slither` | Static analysis with the settings in `slither.config.json` |
| `make gas` | Tests with a gas report |
| `make abis` | Compile, then write the ABIs to `packages/shared/abis/` |
| `make fmt` | Format |
| `make fork` | Start a local fork of Monad mainnet on port 8545. `FORK_BLOCK=<number>` pins the block |
| `make deploy-fork` | Deploy everything to the local fork and write `deployments/fork.json` |
| `./script/e2e-long.sh` | On the fork: open and close a long through the live KyberSwap route |
| `./script/e2e-short.sh` | On the fork: lend stock, open a short and close it through the live route |
| `./script/e2e-protection.sh` | On the fork: open a long near the limit, enter the pre-close window, and let the keeper reduce it through the live route |
| `HandOver.s.sol` | Moves ownership to a timelock controlled by the multisig. Needs `MULTISIG`. See `script/GovernancePlan.sol` |
| `make deploy-vault-fork` | Create the USDC vault over the long markets of the fork deployment |
| `make deploy-monad` | Deploy to Monad mainnet with `DEPLOYER_PRIVATE_KEY` and write `deployments/monad.json` |

Tests and scripts need `--network monad`, which the Makefile passes. The public RPC limits requests, so a test run can fail with a timeout. Run it again or set `MONAD_RPC_URL`.

Run `make abis` after any change to an interface and commit the result in the same PR.

## Deployment files

The deployment script writes `deployments/<environment>.json`. `packages/shared/deployments.ts` holds its schema and `packages/shared/markets.ts` joins the markets with the stock list.

- `fork.json` is not committed. Its addresses depend on the deployer's nonce at the forked block, so they match between machines only when the same `FORK_BLOCK` is used.
- `monad.json` is committed after the mainnet deployment.

The end-to-end scripts ask KyberSwap for live quotes, so each one needs a fresh fork: stop the fork, run `make fork` and `make deploy-fork` again, then run one script. Trades on a fork move its pools away from the live state, and KyberSwap's calldata then fails its own minimum return check with "Return amount is not enough". KyberSwap also refuses to build calldata for the well-known first account of a local node, so `script/lib.sh` uses a second account for swaps taken by a wallet.

## Tests

The tests fork Monad at a pinned block (`FORK_BLOCK` in `test/Base.t.sol`), so they are repeatable and Foundry caches the chain state on disk. Set `FORK_BLOCK` in the environment to try another block.

The swap aggregator is replaced by a small test contract so fills can be set exactly. Everything else is the live chain state. The real aggregator route is covered by `script/e2e-long.sh`.

## Interfaces

The interfaces in `src/interfaces/` are the contract side of the interface agreement in `docs/03-interfaces.md`. Changing them follows the interface change process in `docs/06-team-workflow.md`.

## Gas

Measured in the tests on 13 October 2026, with the test swapper standing in for the aggregator. A real KyberSwap route through one Uniswap v4 pool adds about 350,000 gas to every call that swaps.

| Call | Typical gas | Highest seen |
|---|---|---|
| `openLong` | 770,000 | 810,000 |
| `openShort` | 800,000 | 802,000 |
| `closeLong` | 690,000 | 715,000 |
| `closeShort` | 766,000 | 766,000 |
| First use through `multicall` (two signatures and an open) | 930,000 | 953,000 |
| `deleverage` | 770,000 | 770,000 |
| `removeCollateral` | 356,000 | 365,000 |
| `setProtection` | 93,000 | 93,000 |
| `Liquidator.liquidate` | 515,000 | 632,000 |
| `Lens.getMarkets` with two markets | 221,000 | 221,000 |

Monad charges for the gas limit, not the gas used, so the backend should send a limit taken from simulation.

## Static analysis

`make slither` reports nothing with the current settings. These detectors are switched off after review:

| Detector | Why it does not apply |
|---|---|
| `reentrancy-balance`, `reentrancy-benign`, `reentrancy-events` | Every entry point of the router and the liquidator has a reentrancy guard, and the only external call target for swaps is fixed at deployment. `test/Security.t.sol` proves a hostile target cannot reenter |
| `unused-return` | Return values of Morpho calls and unused fields of the oracle snapshot are ignored on purpose |
| `uninitialized-local` | Locals that start at zero on purpose |
| `incorrect-equality` | A zero execution price is a sentinel for "no swap" |
| `missing-zero-check` | Setting the guardian or the calendar poster to the zero address switches the role off |
| `calls-loop` | Only in `Lens`, which is read-only |
| `timestamp` | Market hours and deadlines need the block time |
