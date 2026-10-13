RPC ?= https://rpc2.monad.xyz
FORK_RPC ?= http://127.0.0.1:8545
# First account of the local fork node. Never holds real funds.
FORK_KEY ?= 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

build:
	forge build

test:
	forge test --network monad

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

deploy-vault-monad:
	DEPLOY_ENV=monad forge script script/DeployVault.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast

deploy-monad:
	DEPLOY_ENV=monad forge script script/Deploy.s.sol --network monad --rpc-url $(RPC) --private-key $(DEPLOYER_PRIVATE_KEY) --broadcast

.PHONY: build test fmt abis fork deploy-fork deploy-vault-fork deploy-monad deploy-vault-monad
