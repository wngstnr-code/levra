#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# buys stock on the exchange and lends it to the QQQ short market (SC-24),
# then opens a small short through the live KyberSwap route and closes it.
# Needs deployments/monad.json (make deploy-monad) and DEPLOYER_PRIVATE_KEY. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."
source script/mainnet-lib.sh

INVENTORY_USD=${INVENTORY_USD:-5000000}
MARGIN=${MARGIN:-3000000}
SHORT_USD=${SHORT_USD:-2000000}
CLOSE=${CLOSE:-yes}
MARKET=$(market short marketId)
ORACLE=$(market short oracle)
PARAMS="($STOCK,$USDC,$ORACLE,$IRM,770000000000000000)"
KYBER_ROUTER=0x6131B5fae19EA4f9D964eAc0408E4408b66337b5

preflight $((INVENTORY_USD + MARGIN)) "stock to lend $INVENTORY_USD, margin $MARGIN"

# Seed inventory: the wallet buys stock itself and lends it, so there is something to borrow.
quote "$USDC" "$STOCK" "$INVENTORY_USD" "$ACCOUNT"
python3 - <<'PY'
import json, sys
answer = json.load(open("/tmp/levra-build.json"))
if "data" not in answer:
    sys.exit(f"KyberSwap refused to build a swap for this wallet: {answer.get('message')} {answer.get('details', '')}")
PY
STOCK_BEFORE=$(stock_balance)
tx "Approve USDC to KyberSwap" "$USDC" "approve(address,uint256)" "$KYBER_ROUTER" "$INVENTORY_USD"
tx "Buy stock with $INVENTORY_USD USDC" "$KYBER_ROUTER" "$(built "d['data']")"
INVENTORY=$(python3 -c "print($(stock_balance) - $STOCK_BEFORE)")
tx "Approve stock to Morpho" "$STOCK" "approve(address,uint256)" "$MORPHO" "$INVENTORY"
tx "Lend $INVENTORY stock to the QQQ short market" "$MORPHO" \
  "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" "$INVENTORY" 0 "$ACCOUNT" 0x

tx "Approve USDC to the router" "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
authorize_router_tx

PRICE=$(price_e8 "$ORACLE")
BORROW=$(python3 -c "print($SHORT_USD * 10**20 // $PRICE)")
python3 -c "import sys; sys.exit(0 if $BORROW <= $INVENTORY else 'The short is larger than the stock that was lent.')"
quote "$STOCK" "$USDC" "$BORROW" "$ROUTER"
PROCEEDS=$(built "d['amountOut']")
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | first)
tx "Open short (margin $MARGIN, borrowing $BORROW stock, expected proceeds $PROCEEDS)" "$ROUTER" \
  "openShort((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$(min_of "$PROCEEDS")"),$SOFT,$(( $(now) + 600 )))"
echo "Position: $(positions)"
echo "LTV $(ltv "$MARKET")"

if [ "$CLOSE" = "yes" ]; then
  # Buying back uses an exact input, so spend a little more than the debt is worth. The extra stock comes back.
  SPEND=$(python3 -c "print($BORROW * $PRICE // 10**20 * ${BUYBACK_BUFFER_PERCENT:-104} // 100)")
  quote "$USDC" "$STOCK" "$SPEND" "$ROUTER"
  BOUGHT=$(built "d['amountOut']")
  python3 -c "import sys; sys.exit(0 if $(min_of "$BOUGHT") > $BORROW else 'The quote may buy less stock than the debt. Raise BUYBACK_BUFFER_PERCENT.')"
  USDC_BEFORE=$(usdc_balance)
  STOCK_BEFORE=$(stock_balance)
  tx "Close short (spending $SPEND USDC to buy back about $BOUGHT stock for a debt of $BORROW)" "$ROUTER" \
    "closeShort((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
    "($MARKET,$MAX,$MAX,$SPEND,$(swap_tuple "$BORROW"),0,$(( $(now) + 600 )))"
  echo "Returned to the account: $(( $(usdc_balance) - USDC_BEFORE )) USDC base units for a margin of $MARGIN, plus $(python3 -c "print($(stock_balance) - $STOCK_BEFORE)") leftover stock"
fi
echo "Router balances after: $(router_balances)"
