#!/usr/bin/env bash
# On a local fork: opens a long, pushes the oracle price down as the Anchored operator,
# and lets the Liquidator close part of the position through the live KyberSwap route.
# Needs a fresh fork (make fork) with the contracts deployed (make deploy-fork).
set -euo pipefail
cd "$(dirname "$0")/.."
source script/lib.sh

MARGIN=${MARGIN:-100000000}
BORROW=${BORROW:-235000000}
DROP_BPS=${DROP_BPS:-1200}
SEIZE_BPS=${SEIZE_BPS:-3000}
MARKET=$(market long marketId)
ORACLE=$(market long oracle)
PARAMS="($USDC,$STOCK,$ORACLE,$IRM,770000000000000000)"
LIQUIDATOR=$(field "d['liquidator']")
STOCK_ORACLE=0x037848af338C38e1e0AB722bE80BF4C2E612a1F7
PRICE_ID=$(cast keccak "QQQ")

echo "Funding the test account, seeding the long market and opening a long"
fund_usdc 2000000000
send "$USDC" "approve(address,uint256)" "$MORPHO" 1000000000
send "$MORPHO" "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" 1000000000 0 "$ACCOUNT" 0x
send "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
authorize_router
FEE_BPS=$(call "$ROUTER" "feeBps()(uint256)")
GROSS=$((MARGIN + BORROW))
SWAP_IN=$((GROSS - GROSS * FEE_BPS / 10000))
quote "$USDC" "$STOCK" "$SWAP_IN" "$ROUTER"
send "$ROUTER" "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,$(swap_tuple "$(min_of "$(built "d['amountOut']")")"),730000000000000000,$(( $(now) + 600 )))"
echo "Opened. LTV $(ltv "$MARKET"), hard limit 770000000000000000"

# Only a fork lets us act as the oracle operator. On mainnet the price comes from Anchored.
OPERATOR=$(call "$STOCK_ORACLE" "getRoleMember(bytes32,uint256)(address)" "$(call "$STOCK_ORACLE" "OPERATOR_ROLE()(bytes32)")" 0)
read -r PRICE BID ASK SESSION <<< "$(call "$STOCK_ORACLE" "latestPrice(bytes32)((int128,int128,int128,uint64,uint64,uint80,uint8))" "$PRICE_ID" | tr -d '()' | python3 -c "
import sys, re
v = [x.strip().split(' ')[0] for x in sys.stdin.read().split(',')]
print(v[0], v[1], v[2], v[6])")"
down() { python3 -c "print($1 * (10000 - $DROP_BPS) // 10000)"; }
cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$OPERATOR" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setBalance "$OPERATOR" 0x56BC75E2D63100000 >/dev/null
cast send --rpc-url "$RPC" --from "$OPERATOR" --unlocked "$STOCK_ORACLE" \
  "updatePrice((bytes32,int256,int256,int256,uint64,uint8))" \
  "($PRICE_ID,$(down "$PRICE"),$(down "$BID"),$(down "$ASK"),$(now),$SESSION)" >/dev/null
cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$OPERATOR" >/dev/null
echo "Oracle price pushed down by $DROP_BPS bps. LTV $(ltv "$MARKET")"

# The fork deployer owns the Liquidator and is its treasury, so it can also be the keeper here.
send "$LIQUIDATOR" "setKeeper(address,bool)" "$ACCOUNT" true
COLLATERAL=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$ACCOUNT" | sed -n '3p' | first)
SEIZED=$(python3 -c "print($COLLATERAL * $SEIZE_BPS // 10000)")
quote "$STOCK" "$USDC" "$SEIZED" "$LIQUIDATOR"
PROCEEDS=$(built "d['amountOut']")
BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
echo "Liquidating: seizing $SEIZED stock, expected proceeds $PROCEEDS USDC"
send "$LIQUIDATOR" "liquidate(bytes32,address,uint256,uint256,(address,bytes,uint256),int256,uint256)" \
  "$MARKET" "$ACCOUNT" "$SEIZED" "$SEIZED" "$(swap_tuple "$(min_of "$PROCEEDS")")" 0 0
AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$ACCOUNT" | first)

echo "After. LTV $(ltv "$MARKET")"
echo "Gain sent to the treasury: $((AFTER - BEFORE)) USDC base units"
echo "Liquidator balances after: USDC $(call "$USDC" "balanceOf(address)(uint256)" "$LIQUIDATOR" | first), stock $(call "$STOCK" "balanceOf(address)(uint256)" "$LIQUIDATOR" | first)"
