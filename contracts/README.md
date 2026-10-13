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
| `make abis` | Compile, then write the ABIs to `packages/shared/abis/` |
| `make fmt` | Format |
| `make fork` | Start a local fork of Monad mainnet on port 8545. `FORK_BLOCK=<number>` pins the block |
| `make deploy-fork` | Deploy everything to the local fork and write `deployments/fork.json` |
| `./script/e2e-long.sh` | On the fork: open and close a long through the live KyberSwap route |
| `./script/e2e-short.sh` | On the fork: lend stock, open a short and close it through the live route |
| `./script/e2e-protection.sh` | On the fork: open a long near the limit, enter the pre-close window, and let the keeper reduce it through the live route |
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

The swap aggregator is replaced by a small test contract so fills can be set exactly. Everything else is the live chain state. The real aggregator route is covered by `script/e2e-long.sh`.

## Interfaces

The interfaces in `src/interfaces/` are the contract side of the interface agreement in `docs/03-interfaces.md`. Changing them follows the interface change process in `docs/06-team-workflow.md`.
