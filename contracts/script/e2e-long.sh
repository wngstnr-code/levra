#!/usr/bin/env bash
# Opens and closes a real long on a local fork, swapping through the live KyberSwap route.
# Needs a running fork (make fork) with the contracts deployed (make deploy-fork).
set -euo pipefail
cd "$(dirname "$0")/.."
source script/lib.sh

MARGIN=${MARGIN:-50000000}
BORROW=${BORROW:-50000000}
MARKET=$(market long marketId)
ORACLE=$(market long oracle)
PARAMS=$(market_params long)

echo "Funding the test account and seeding the long market"
fund_usdc 2000000000
send "$USDC" "approve(address,uint256)" "$MORPHO" 1000000000
send "$MORPHO" "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" 1000000000 0 "$ACCOUNT" 0x
send "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
authorize_router

FEE_BPS=$(call "$ROUTER" "feeBps()(uint256)")
GROSS=$((MARGIN + BORROW))
SWAP_IN=$((GROSS - GROSS * FEE_BPS / 10000))
quote "$USDC" "$STOCK" "$SWAP_IN" "$ROUTER"
OUT=$(built "d['amountOut']")
MIN_OUT=$(min_of "$OUT")
DEADLINE=$(( $(now) + 600 ))
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)

echo "Opening long: margin $MARGIN, borrow $BORROW, swap in $SWAP_IN, expected stock $OUT"
send "$ROUTER" "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$MIN_OUT"),$SOFT,$DEADLINE)"
positions
COLLATERAL=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT" | sed -n '3p' | first)

quote "$STOCK" "$USDC" "$COLLATERAL" "$ROUTER"
BACK=$(built "d['amountOut']")
MIN_BACK=$(min_of "$BACK")
BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
echo "Closing long: selling $COLLATERAL stock, expected USDC $BACK"
send "$ROUTER" "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MAX,$MAX,$MAX,$(swap_tuple "$MIN_BACK"),0,$DEADLINE)"
AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)

echo "Returned to the user: $((AFTER - BEFORE)) USDC base units for a margin of $MARGIN"
echo "Router balances after: $(router_balances)"
echo "Positions after: $(positions)"
