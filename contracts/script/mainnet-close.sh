#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# closes the wallet's position in one market in full through the live KyberSwap route.
# SYMBOL picks the stock (QQQ, HOOD or BIL) and SIDE the market (long or short).
# Does nothing when there is no position. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."
source script/mainnet-lib.sh

SIDE=${SIDE:-long}
if ! has_market "$SIDE"; then
  exit 0
fi
MARKET=$(market "$SIDE" marketId)
ORACLE=$(market "$SIDE" oracle)
POSITION=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT")
BORROW_SHARES=$(sed -n '2p' <<<"$POSITION" | first)
COLLATERAL=$(sed -n '3p' <<<"$POSITION" | first)
if [ "$BORROW_SHARES" = "0" ]; then
  if [ "$COLLATERAL" != "0" ]; then
    echo "$SYMBOL $SIDE: $COLLATERAL of collateral with no debt. Take it out with removeCollateral."
  else
    echo "$SYMBOL $SIDE: no position"
  fi
  exit 0
fi

echo "$SYMBOL $SIDE: collateral $COLLATERAL, borrow shares $BORROW_SHARES"
preflight 0 "closing the $SYMBOL $SIDE"
authorize_router_tx
USDC_BEFORE=$(usdc_balance)
STOCK_BEFORE=$(stock_balance)

if [ "$SIDE" = "long" ]; then
  quote "$STOCK" "$USDC" "$COLLATERAL" "$ROUTER"
  BACK=$(built "d['amountOut']")
  tx "Close $SYMBOL long (selling $COLLATERAL stock, expected USDC $BACK)" "$ROUTER" \
    "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
    "($MARKET,$MAX,$MAX,$MAX,$(swap_tuple "$(min_of "$BACK")"),0,$(( $(now) + 600 )))"
else
  # Debt in stock from Morpho's share price, rounded up, plus 0.1% for interest since the last update.
  TOTALS=$(call "$MORPHO" "market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)" "$MARKET")
  DEBT=$(python3 -c "
assets, shares = $(sed -n '3p' <<<"$TOTALS" | first), $(sed -n '4p' <<<"$TOTALS" | first)
debt = -(-$BORROW_SHARES * (assets + 1) // (shares + 10**6))
print(debt * 1001 // 1000 + 1)")
  quote_buyback "$DEBT" "$(price_e8 "$ORACLE")" "$ROUTER"
  tx "Close $SYMBOL short (spending $SPEND USDC to buy back about $BOUGHT stock for a debt of about $DEBT)" "$ROUTER" \
    "closeShort((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
    "($MARKET,$MAX,$MAX,$SPEND,$(swap_tuple "$DEBT"),0,$(( $(now) + 600 )))"
fi
echo "Returned to the account: $(( $(usdc_balance) - USDC_BEFORE )) USDC base units and $(python3 -c "print($(stock_balance) - $STOCK_BEFORE)") stock"
echo "Router balances after: $(router_balances)"
