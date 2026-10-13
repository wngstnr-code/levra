#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# seeds the long market of one stock, opens a small long through the live KyberSwap route, and closes it.
# SYMBOL picks the stock: QQQ (default), HOOD or BIL.
# Needs deployments/monad.json (make deploy-monad) and DEPLOYER_PRIVATE_KEY. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."
source script/mainnet-lib.sh

SEED=${SEED:-3000000}
MARGIN=${MARGIN:-2000000}
BORROW=${BORROW:-2000000}
CLOSE=${CLOSE:-yes}
MARKET=$(market long marketId)
ORACLE=$(market long oracle)
PARAMS=$(market_params long)

preflight $((SEED + MARGIN)) "$SYMBOL long: seed $SEED, margin $MARGIN"

tx "Approve USDC to Morpho" "$USDC" "approve(address,uint256)" "$MORPHO" "$SEED"
tx "Supply $SEED USDC to the $SYMBOL long market" "$MORPHO" \
  "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" "$SEED" 0 "$ACCOUNT" 0x
tx "Approve USDC to the router" "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
authorize_router_tx

FEE_BPS=$(call "$ROUTER" "feeBps()(uint256)")
GROSS=$((MARGIN + BORROW))
SWAP_IN=$((GROSS - GROSS * FEE_BPS / 10000))
quote "$USDC" "$STOCK" "$SWAP_IN" "$ROUTER"
OUT=$(built "d['amountOut']")
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)
tx "Open $SYMBOL long (margin $MARGIN, borrow $BORROW, expected stock $OUT)" "$ROUTER" \
  "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$(min_of "$OUT")"),$SOFT,$(( $(now) + 600 )))"
echo "Position: $(positions)"
echo "LTV $(ltv "$MARKET")"

if [ "$CLOSE" = "yes" ]; then
  COLLATERAL=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT" | sed -n '3p' | first)
  quote "$STOCK" "$USDC" "$COLLATERAL" "$ROUTER"
  BACK=$(built "d['amountOut']")
  BEFORE=$(usdc_balance)
  tx "Close $SYMBOL long (selling $COLLATERAL stock, expected USDC $BACK)" "$ROUTER" \
    "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
    "($MARKET,$MAX,$MAX,$MAX,$(swap_tuple "$(min_of "$BACK")"),0,$(( $(now) + 600 )))"
  echo "Returned to the account: $(( $(usdc_balance) - BEFORE )) USDC base units for a margin of $MARGIN"
fi
echo "Router balances after: $(router_balances)"
