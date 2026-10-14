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
| `./script/e2e-long.sh` | On the fork: open and close a long through the live KyberSwap route. `SYMBOL` picks the stock, here and in the scripts below |
| `./script/e2e-short.sh` | On the fork: lend stock, open a short and close it through the live route |
| `./script/e2e-liquidation.sh` | On the fork: open a long, push the oracle price down as the Anchored operator, and liquidate through the live route |
| `./script/e2e-protection.sh` | On the fork: open a long near the limit, enter the pre-close window, and let the keeper reduce it through the live route |
| `HandOver.s.sol` | Moves ownership of the contracts to a timelock controlled by the multisig, and the vault to the multisig. Needs `MULTISIG`. See `script/GovernancePlan.sol` |
| `make deploy-vault-fork` | Create the USDC vault over the long markets of the fork deployment |
| `make first-run-monad` | REAL transactions on mainnet for every market: long on QQQ, HOOD and BIL, short on QQQ and HOOD. A dry run unless `CONFIRM=yes` |
| `make first-long-monad` | The same for one long. `SYMBOL` picks the stock |
| `make first-short-monad` | The same for one short, including buying the stock that is lent. `SYMBOL` picks the stock |
| `make deploy-monad` | Deploy to Monad mainnet with `DEPLOYER_PRIVATE_KEY` and write `deployments/monad.json` |

Tests and scripts need `--network monad`, which the Makefile passes. The public RPC limits requests, so a test run can fail with a timeout. Run it again or set `MONAD_RPC_URL`.

Run `make abis` after any change to an interface and commit the result in the same PR. The Morpho ABI is built from `IMorpho` plus the events in Morpho's `EventsLib`, which `src/interfaces/MorphoEvents.sol` pulls into the build.

## First run on mainnet with a small budget

A fresh wallet with about 20 MON and 20 USDC is enough to open and close a real position in every market in scope: a long on QQQ, HOOD and BIL, and a short on QQQ and HOOD. Rehearsed on a fork with a 20 USDC wallet. One long alone needs 5 USDC.

1. Copy `.env.example` to `.env` and put the key of that wallet in `DEPLOYER_PRIVATE_KEY`. Never commit it.
2. `make deploy-monad` deploys the contracts and five markets and writes `deployments/monad.json`. About 3.5 MON.
3. `make first-run-monad` shows what the first step would do. `make first-run-monad CONFIRM=yes` sends everything, market by market, and prints every transaction hash. It stops at the first transaction that reverts.
4. Commit `deployments/monad.json` and record the hashes in `docs/PROGRESS.md`.

With only 10 USDC, run it at half size. Rehearsed on a fork with a wallet holding exactly 10 USDC: all five markets opened and closed, and 2.30 USDC was left free at the end.

```bash
SEED=1500000 MARGIN=1000000 BORROW=1000000 INVENTORY_USD=1500000 SHORT_USD=750000 make first-run-monad CONFIRM=yes
```

At the default sizes 10 USDC covers two longs only. The script stops before the third, without sending anything, because the wallet holds too little.

One market at a time: `make first-long-monad SYMBOL=HOOD CONFIRM=yes` or `make first-short-monad SYMBOL=QQQ CONFIRM=yes`. `SYMBOL` is `QQQ` (default), `HOOD` or `BIL`. BIL has no short market.

What each step does and what the rehearsal showed:

| Market | What is sent | Result in the rehearsal |
|---|---|---|
| Long, each stock | 3 USDC lent to the market, a long with 2 USDC of margin and 2 USDC borrowed, a full close | QQQ opened at 49.5% LTV and returned 1.92 USDC. HOOD opened at 54.0% and returned 1.92. BIL opened at 50.3% and returned 1.97 |
| Short, QQQ and HOOD | 3 USDC of the stock bought and lent to its short market (the seed inventory of SC-24), a short of 1.5 USDC of stock with 2 USDC of margin, a full close | QQQ opened at 43.4% and returned 1.89 USDC plus a little stock. HOOD opened at 41.9% and returned 1.89 plus a little stock |
| End | 30 transactions, no position left open, router empty | 4.59 USDC free in the wallet, plus 9 USDC and the bought stock still lent, which can be withdrawn |

Things to know:

- HOOD opens at a higher LTV than QQQ for the same leverage, because aHOOD trades above its oracle price on the exchange. For the same reason the buy-back of a short is sized from the exchange quote, not from the oracle price.
- Every transaction is sent with the gas estimate plus 50%. With the bare estimate, a close ran out of gas in the rehearsal: the router's nested calls (flash loan, callback, swap) need more than the estimate says. Monad charges for the limit, so this margin costs a little MON.
- Settings such as `SEED`, `MARGIN`, `BORROW`, `INVENTORY_USD`, `SHORT_USD`, `CLOSE=no`, `LONGS` and `SHORTS` can be passed in the environment.
- KyberSwap refuses to build a swap for some wallets. If that happens the short script stops before sending anything.

## First deposit into the vault

After `make deploy-vault-monad`, `make first-earn-monad CONFIRM=yes` deposits 1 USDC into the vault, prints which market it reached and redeems it again. `AMOUNT` changes the size in USDC base units and `WITHDRAW=no` leaves the deposit in. Without `CONFIRM=yes` it is a dry run.

## Closing everything after a demo

`make close-all-monad CONFIRM=yes` closes every open position of the deployer wallet through the router and redeems its shares of the USDC vault. It does nothing where there is no position, and it leaves the seed lending in the markets. Without `CONFIRM=yes` it only lists what it would close. `SYMBOL=HOOD SIDE=short ./script/mainnet-close.sh` closes one position.

## Deployment settings

Environment variables read by `script/Deploy.s.sol`. All are optional on a fork.

| Variable | What it sets |
|---|---|
| `DEPLOY_ENV` | Name of the deployment file, `fork` or `monad` |
| `OWNER` | Owner of the contracts after deployment. Defaults to the deployer |
| `FEE_RECIPIENT` | Receives fees and liquidation gains. Defaults to the deployer |
| `KEEPER` | May run auto-deleverage on the router |
| `LIQUIDATOR_KEEPER` | May call the `Liquidator`. Defaults to `KEEPER` |
| `CALENDAR_POSTER` | May post the next market close |
| `ORACLE_AGE_POSTER` | May move `maxOracleAge` inside the bounds (D-31) |

The four roles can also be set after deployment. `make set-roles-monad` reads the same variables, shows what it would change, and sends the transactions from the owner wallet only with `CONFIRM=yes`. It skips a role that is empty or already set. Use one key per role. Pass the addresses after `make` (`make set-roles-monad KEEPER=0x... CONFIRM=yes`): a line in `.env`, even an empty one, wins over a variable typed in front of `make`.

Oracle ages per market are fixed in the script and come from two weeks of oracle data (`docs/reports/oracle-2026-10-13.md`):

| Market | Hard source quote age while open | Hard publish age while closed | Age to open a position |
|---|---|---|---|
| QQQ | 1 hour | 4 days | 35 minutes |
| HOOD | 1 hour | 4 days | 36 minutes |
| BIL | 3 hours | 4 days | 51 minutes |

The two hard ages cannot be changed after deployment. The age to open a position can be moved by the oracle age poster between 1,500 seconds and the hard source quote age.

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
