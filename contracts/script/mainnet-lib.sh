#!/usr/bin/env bash
# Shared setup for the scripts that send REAL transactions on Monad mainnet with the deployer wallet.
# They read deployments/monad.json and do nothing unless CONFIRM=yes.

: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in contracts/.env}"
export FORK_RPC=${RPC:-https://rpc.monad.xyz}
export FORK_KEY=$DEPLOYER_PRIVATE_KEY
export DEPLOYMENT=${DEPLOYMENT:-deployments/monad.json}
export SLIPPAGE_BPS=${SLIPPAGE_BPS:-150}
source script/lib.sh

# Like send, but prints the transaction hash so it can be recorded. Stops the script if the transaction reverts.
tx() {
  local label=$1
  shift
  local hash
  hash=$(send_as "$KEY" "$ACCOUNT" "$@")
  echo "$label: $hash"
}

usdc_balance() { call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first; }
stock_balance() { call "$STOCK" "balanceOf(address)(uint256)" "$ACCOUNT" | first; }

# Prints what the run needs and stops unless there is enough USDC and CONFIRM=yes.
preflight() {
  local needed=$1 what=$2
  local balance
  balance=$(usdc_balance)
  echo "Account $ACCOUNT on chain $(cast chain-id --rpc-url "$RPC")"
  echo "USDC balance $balance, needed $needed ($what). MON balance $(cast balance --rpc-url "$RPC" "$ACCOUNT")"
  python3 -c "import sys; sys.exit(0 if $balance >= $needed else 'Not enough USDC for this run.')"
  if [ "${CONFIRM:-}" != "yes" ]; then
    echo "Dry run only. Nothing was sent. Run again with CONFIRM=yes to send real transactions."
    exit 0
  fi
}

authorize_router_tx() {
  if [ "$(call "$MORPHO" "isAuthorized(address,address)(bool)" "$ACCOUNT" "$ROUTER")" != "true" ]; then
    tx "Authorize the router on Morpho" "$MORPHO" "setAuthorization(address,bool)" "$ROUTER" true
  fi
}
