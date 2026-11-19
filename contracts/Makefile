# Local settings such as DEPLOYER_PRIVATE_KEY live in contracts/.env, which is not committed.
-include .env
export

RPC ?= https://rpc2.monad.xyz
FORK_RPC ?= http://127.0.0.1:8545
# First account of the local fork node. Never holds real funds.
FORK_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

build:
	forge build

# The invariant campaign is slow on a fork, so it has its own target.
# Base and X Layer forks run apart, because a Monad EVM cannot fork them. Coinbase stock tokens cannot run on any fork.
test:
	forge test --network monad --no-match-contract 'InvariantsTest|BaseForkTest|XLayerForkTest'
	forge test --network optimism --match-contract 'BaseForkTest|XLayerForkTest'

invariants:
	forge test --network monad --match-contract InvariantsTest -vv

slither:
	slither .

gas:
	forge test --network monad --no-match-contract InvariantsTest --gas-report

fmt:
	forge fmt

abis: build
	node script/export-abis.mjs

# Set FORK_BLOCK to get the same addresses on every machine. Live swap routes need the latest block.
fork:
	anvil --fork-url $(RPC) --port 8545 $(if $(FORK_BLOCK),--fork-block-number $(FORK_BLOCK))

deploy-fork:
	DEPLOY_ENV=fork DEPLOY_CONFIG=config/monad.json forge script script/Deploy.s.sol --network monad --rpc-url $(FORK_RPC) --private-key $(FORK_KEY) --broadcast

deploy-vault-fork:
	DEPLOY_ENV=fork forge script script/DeployVault.s.sol --network monad --rpc-url $(FORK_RPC) --private-key $(FORK_KEY) --broadcast

# The @ keeps make from printing the private key with the command.
# REAL transactions on Monad mainnet: a new router and lens over the live risk manager (SC-87).
# Pass KEEPER to grant the keeper role on the new router. Updates deployments/monad.json.
redeploy-router-monad:
	@DEPLOY_ENV=monad DEPLOY_CONFIG=config/monad.json forge script script/RedeployRouter.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

deploy-vault-monad:
	@DEPLOY_ENV=monad forge script script/DeployVault.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

# The six targets below send real transactions on Monad mainnet. They are dry runs unless CONFIRM=yes.
# SYMBOL picks the stock for the first two: QQQ (default), HOOD or BIL.

# Every market in scope: long on QQQ, HOOD and BIL, then short on QQQ and HOOD.
first-run-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-first-run.sh

# Seeds the long market of one stock, opens a small long and closes it.
first-long-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-first-long.sh

# Buys one stock and lends it to its short market, opens a small short and closes it.
first-short-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-first-short.sh

# Deposits USDC into the vault, shows which market it reached and withdraws it. AMOUNT in USDC base units.
first-earn-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-first-earn.sh

# Closes every open position of the wallet and redeems its vault shares. Seed lending stays.
close-all-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-close-all.sh

# Gives the keeper and poster roles to the addresses in .env. Skips what is empty or already set.
set-roles-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-set-roles.sh

deploy-monad:
	@DEPLOY_ENV=monad DEPLOY_CONFIG=config/monad.json forge script script/Deploy.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

BASE_RPC ?= https://mainnet.base.org

# Simulates the Base deployment against the live chain. Sends nothing and writes no file.
deploy-base-dry:
	DEPLOY_ENV=base DEPLOY_CONFIG=config/base.json forge script script/Deploy.s.sol --network optimism --rpc-url $(BASE_RPC)

# Full long and short through 1inch, KyberSwap and Aero inside eth_simulateV1 on the live Base node (SC-75).
# Sends nothing. Needs ONEINCH_API_KEY, for example: set -a; . ../.env; set +a; make base-live-e2e
base-live-e2e: build
	node script/base-live-e2e.mjs

# REAL transactions on Base mainnet. Needs DEPLOYER_PRIVATE_KEY with ETH on Base (SC-76).
deploy-base:
	@DEPLOY_ENV=base DEPLOY_CONFIG=config/base.json forge script script/Deploy.s.sol --network optimism --rpc-url $(BASE_RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

.PHONY: redeploy-router-monad base-live-e2e deploy-base-dry deploy-base build test invariants slither gas fmt abis fork deploy-fork deploy-vault-fork deploy-monad deploy-vault-monad first-long-monad first-short-monad first-run-monad first-earn-monad close-all-monad set-roles-monad
