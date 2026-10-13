#!/usr/bin/env bash
# Opens and closes a real short on a local fork, swapping through the live KyberSwap route.
# Needs a running fork (make fork) with the contracts deployed (make deploy-fork).
set -euo pipefail
cd "$(dirname "$0")/.."
source script/lib.sh

MARGIN=${MARGIN:-50000000}
SHORT_USD=${SHORT_USD:-30000000}
MARKET=$(market short marketId)
ORACLE=$(market short oracle)
PARAMS=$(market_params short)
KYBER_ROUTER=0x6131B5fae19EA4f9D964eAc0408E4408b66337b5

echo "Funding the test account, buying stock on the exchange and lending it to the short market"
fund_usdc 1000000000
fund_usdc_to "$LENDER" 200000000
cast rpc --rpc-url "$RPC" anvil_setBalance "$LENDER" 0x56BC75E2D63100000 >/dev/null
quote "$USDC" "$STOCK" 200000000 "$LENDER"
lender_send "$USDC" "approve(address,uint256)" "$KYBER_ROUTER" 200000000
lender_send "$KYBER_ROUTER" "$(built "d['data']")"
INVENTORY=$(call "$STOCK" "balanceOf(address)(uint256)" "$LENDER" | first)
lender_send "$STOCK" "approve(address,uint256)" "$MORPHO" "$INVENTORY"
lender_send "$MORPHO" "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" "$INVENTORY" 0 "$LENDER" 0x
echo "Lent $INVENTORY stock"

send "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
authorize_router
PRICE=$(price_e8 "$ORACLE")
BORROW=$(python3 -c "print($SHORT_USD * 10**20 // $PRICE)")
quote "$STOCK" "$USDC" "$BORROW" "$ROUTER"
PROCEEDS=$(built "d['amountOut']")
MIN_OUT=$(min_of "$PROCEEDS")
DEADLINE=$(( $(now) + 600 ))
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)

echo "Opening short: margin $MARGIN, borrowing $BORROW stock, expected proceeds $PROCEEDS"
send "$ROUTER" "openShort((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$MIN_OUT"),$SOFT,$DEADLINE)"
positions

# The buy-back is a little larger than the debt. The extra stock comes back to the account.
quote_buyback "$BORROW" "$PRICE" "$ROUTER"
BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
STOCK_BEFORE=$(call "$STOCK" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
echo "Closing short: spending $SPEND USDC to buy back about $BOUGHT stock for a debt of $BORROW"
send "$ROUTER" "closeShort((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MAX,$MAX,$SPEND,$(swap_tuple "$BORROW"),0,$DEADLINE)"
AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
STOCK_AFTER=$(call "$STOCK" "balanceOf(address)(uint256)" "$ACCOUNT" | first)

echo "Returned to the user: $((AFTER - BEFORE)) USDC base units for a margin of $MARGIN, plus $(python3 -c "print($STOCK_AFTER - $STOCK_BEFORE)") leftover stock"
echo "Router balances after: $(router_balances)"
echo "Positions after: $(positions)"
