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
test:
	forge test --network monad --no-match-contract InvariantsTest

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
	DEPLOY_ENV=fork forge script script/Deploy.s.sol --network monad --rpc-url $(FORK_RPC) --private-key $(FORK_KEY) --broadcast

deploy-vault-fork:
	DEPLOY_ENV=fork forge script script/DeployVault.s.sol --network monad --rpc-url $(FORK_RPC) --private-key $(FORK_KEY) --broadcast

# The @ keeps make from printing the private key with the command.
deploy-vault-monad:
	@DEPLOY_ENV=monad forge script script/DeployVault.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

# The four targets below send real transactions on Monad mainnet. They are dry runs unless CONFIRM=yes.
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

# Gives the keeper and poster roles to the addresses in .env. Skips what is empty or already set.
set-roles-monad:
	CONFIRM=$(CONFIRM) ./script/mainnet-set-roles.sh

deploy-monad:
	@DEPLOY_ENV=monad forge script script/Deploy.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast --slow

.PHONY: build test invariants slither gas fmt abis fork deploy-fork deploy-vault-fork deploy-monad deploy-vault-monad first-long-monad first-short-monad first-run-monad set-roles-monad
