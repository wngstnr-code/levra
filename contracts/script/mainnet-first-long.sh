#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# seeds the QQQ long market, opens a small long through the live KyberSwap route, and closes it.
# Needs deployments/monad.json (make deploy-monad) and DEPLOYER_PRIVATE_KEY. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEPLOYER_PRIVATE_KEY:?Set DEPLOYER_PRIVATE_KEY in contracts/.env}"
export FORK_RPC=${RPC:-https://rpc.monad.xyz}
export FORK_KEY=$DEPLOYER_PRIVATE_KEY
export DEPLOYMENT=${DEPLOYMENT:-deployments/monad.json}
export SLIPPAGE_BPS=${SLIPPAGE_BPS:-150}
source script/lib.sh

SEED=${SEED:-5000000}
MARGIN=${MARGIN:-3000000}
BORROW=${BORROW:-3000000}
CLOSE=${CLOSE:-yes}
MARKET=$(market long marketId)
ORACLE=$(market long oracle)
PARAMS="($USDC,$STOCK,$ORACLE,$IRM,770000000000000000)"

# Like send, but prints the transaction hash so it can be recorded.
tx() {
  local label=$1
  shift
  local hash
  hash=$(cast send --rpc-url "$RPC" --private-key "$KEY" --json "$@" | python3 -c "import json,sys; print(json.load(sys.stdin)['transactionHash'])")
  echo "$label: $hash"
}

BALANCE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
NEEDED=$((SEED + MARGIN))
echo "Account $ACCOUNT on chain $(cast chain-id --rpc-url "$RPC")"
echo "USDC balance $BALANCE, needed $NEEDED (seed $SEED, margin $MARGIN). MON balance $(cast balance --rpc-url "$RPC" "$ACCOUNT")"
python3 -c "import sys; sys.exit(0 if $BALANCE >= $NEEDED else 'Not enough USDC for this run.')"
if [ "${CONFIRM:-}" != "yes" ]; then
  echo "Dry run only. Nothing was sent. Run again with CONFIRM=yes to send real transactions."
  exit 0
fi

tx "Approve USDC to Morpho" "$USDC" "approve(address,uint256)" "$MORPHO" "$SEED"
tx "Supply $SEED USDC to the QQQ long market" "$MORPHO" \
  "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" "$SEED" 0 "$ACCOUNT" 0x
tx "Approve USDC to the router" "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
if [ "$(call "$MORPHO" "isAuthorized(address,address)(bool)" "$ACCOUNT" "$ROUTER")" != "true" ]; then
  tx "Authorize the router on Morpho" "$MORPHO" "setAuthorization(address,bool)" "$ROUTER" true
fi

FEE_BPS=$(call "$ROUTER" "feeBps()(uint256)")
GROSS=$((MARGIN + BORROW))
SWAP_IN=$((GROSS - GROSS * FEE_BPS / 10000))
quote "$USDC" "$STOCK" "$SWAP_IN" "$ROUTER"
OUT=$(built "d['amountOut']")
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)
tx "Open long (margin $MARGIN, borrow $BORROW, expected stock $OUT)" "$ROUTER" \
  "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$(min_of "$OUT")"),$SOFT,$(( $(now) + 600 )))"
echo "Position: $(positions)"
echo "LTV $(ltv "$MARKET")"

if [ "$CLOSE" = "yes" ]; then
  COLLATERAL=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT" | sed -n '3p' | first)
  quote "$STOCK" "$USDC" "$COLLATERAL" "$ROUTER"
  BACK=$(built "d['amountOut']")
  BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
  tx "Close long (selling $COLLATERAL stock, expected USDC $BACK)" "$ROUTER" \
    "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
    "($MARKET,$MAX,$MAX,$MAX,$(swap_tuple "$(min_of "$BACK")"),0,$(( $(now) + 600 )))"
  AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
  echo "Returned to the account: $((AFTER - BEFORE)) USDC base units for a margin of $MARGIN"
fi
echo "Router balances after: $(router_balances)"
