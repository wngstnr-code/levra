#!/usr/bin/env bash
# On a local fork: opens a long near the soft limit, moves into the pre-close window,
# and lets the keeper reduce it through the live KyberSwap route.
# Needs a running fork (make fork) with the contracts deployed (make deploy-fork).
set -euo pipefail
cd "$(dirname "$0")/.."
source script/lib.sh

MARGIN=${MARGIN:-100000000}
BORROW=${BORROW:-235000000}
SELL_USD=${SELL_USD:-45000000}
REPAY_SHARE_BPS=${REPAY_SHARE_BPS:-1700}
MARKET=$(market long marketId)
ORACLE=$(market long oracle)
PARAMS="($USDC,$STOCK,$ORACLE,$IRM,770000000000000000)"

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
MIN_OUT=$(min_of "$(built "d['amountOut']")")
DEADLINE=$(( $(now) + 600 ))
send "$ROUTER" "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$MIN_OUT"),730000000000000000,$DEADLINE)"
echo "Opened. LTV $(ltv "$MARKET"), soft limit $(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)"

# The fork deployer owns the contracts, so it can act as calendar poster and keeper here.
send "$ROUTER" "setProtection(bytes32,bool)" "$MARKET" true
send "$ROUTER" "setKeeper(address,bool)" "$ACCOUNT" true
send "$RISK" "setNextCloseAt(uint64)" $(( $(now) + 3600 ))
echo "Pre-close window. LTV $(ltv "$MARKET"), soft limit $(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)"

PRICE=$(price_e8 "$ORACLE")
SELL=$(python3 -c "print($SELL_USD * 10**20 // $PRICE)")
SHARES=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT" | sed -n '2p' | first)
REPAY_SHARES=$(python3 -c "print($SHARES * $REPAY_SHARE_BPS // 10000)")
quote "$STOCK" "$USDC" "$SELL" "$ROUTER"
PROCEEDS=$(built "d['amountOut']")
MIN_BACK=$(min_of "$PROCEEDS")
BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
echo "Keeper sells $SELL stock for about $PROCEEDS USDC and repays $REPAY_SHARE_BPS bps of the debt"
send "$ROUTER" "deleverage(address,(bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "$ACCOUNT" "($MARKET,$REPAY_SHARES,$SELL,$SELL,$(swap_tuple "$MIN_BACK"),0,$(( $(now) + 600 )))"
AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)

echo "After. LTV $(ltv "$MARKET"), soft limit $(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)"
echo "USDC received by the account (leftover plus keeper fee, since it plays both roles): $((AFTER - BEFORE))"
echo "Router balances after: $(router_balances)"
