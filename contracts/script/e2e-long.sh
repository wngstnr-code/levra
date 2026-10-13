#!/usr/bin/env bash
# Opens and closes a real long on a local fork, swapping through the live KyberSwap route.
# Needs a running fork (make fork) with the contracts deployed (make deploy-fork).
set -euo pipefail

RPC=${FORK_RPC:-http://127.0.0.1:8545}
KEY=${FORK_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
DEPLOYMENT=${DEPLOYMENT:-deployments/fork.json}
MARGIN=${MARGIN:-50000000}
BORROW=${BORROW:-50000000}

MORPHO=0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
STOCK=0x1446501E886c7f830DB9b494A1890cBCCC072f57
KYBER=https://aggregator-api.kyberswap.com/monad/api/v1

field() { python3 -c "import json,sys; d=json.load(open('$DEPLOYMENT')); print($1)"; }
ROUTER=$(field "d['router']")
LENS=$(field "d['lens']")
RISK=$(field "d['riskManager']")
MARKET=$(field "[m for m in d['markets'] if m['symbol']=='QQQ' and m['side']=='long'][0]['marketId']")
ORACLE=$(field "[m for m in d['markets'] if m['symbol']=='QQQ' and m['side']=='long'][0]['oracle']")
USER=$(cast wallet address --private-key "$KEY")
PARAMS="($USDC,$STOCK,$ORACLE,0x09475a3D6eA8c314c592b1a3799bDE044E2F400F,770000000000000000)"

send() { cast send --rpc-url "$RPC" --private-key "$KEY" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }

# Kyber answers with a route and calldata for a swap where the router is both sender and recipient.
quote() {
  local token_in=$1 token_out=$2 amount=$3
  curl -s -H "x-client-id: levra" "$KYBER/routes?tokenIn=$token_in&tokenOut=$token_out&amountIn=$amount" > /tmp/levra-route.json
  python3 - "$ROUTER" <<'PY' > /tmp/levra-build-body.json
import json, sys
route = json.load(open("/tmp/levra-route.json"))["data"]["routeSummary"]
print(json.dumps({"routeSummary": route, "sender": sys.argv[1], "recipient": sys.argv[1], "slippageTolerance": 100}))
PY
  curl -s -X POST -H "content-type: application/json" -H "x-client-id: levra" --data @/tmp/levra-build-body.json "$KYBER/route/build" > /tmp/levra-build.json
}
built() { python3 -c "import json; d=json.load(open('/tmp/levra-build.json'))['data']; print($1)"; }

echo "Funding the test user and seeding the market on the fork"
cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$MORPHO" >/dev/null
cast rpc --rpc-url "$RPC" anvil_setBalance "$MORPHO" 0x56BC75E2D63100000 >/dev/null
cast send --rpc-url "$RPC" --from "$MORPHO" --unlocked "$USDC" "transfer(address,uint256)" "$USER" 2000000000 >/dev/null
cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$MORPHO" >/dev/null
send "$USDC" "approve(address,uint256)" "$MORPHO" 1000000000
send "$MORPHO" "supply((address,address,address,address,uint256),uint256,uint256,address,bytes)" "$PARAMS" 1000000000 0 "$USER" 0x
send "$USDC" "approve(address,uint256)" "$ROUTER" "$MARGIN"
send "$MORPHO" "setAuthorization(address,bool)" "$ROUTER" true

FEE_BPS=$(call "$ROUTER" "feeBps()(uint256)")
GROSS=$((MARGIN + BORROW))
SWAP_IN=$((GROSS - GROSS * FEE_BPS / 10000))
quote "$USDC" "$STOCK" "$SWAP_IN"
OUT=$(built "d['amountOut']")
MIN_OUT=$(python3 -c "print($OUT * 9900 // 10000)")
DEADLINE=$(( $(cast block --rpc-url "$RPC" latest -f timestamp) + 600 ))
SOFT=$(call "$RISK" "currentSoftLtv(bytes32)(uint256)" "$MARKET" | awk '{print $1}')

echo "Opening long: margin $MARGIN, borrow $BORROW, swap in $SWAP_IN, expected stock $OUT"
send "$ROUTER" "openLong((bytes32,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MARGIN,$BORROW,($(built "d['routerAddress']"),$(built "d['data']"),$MIN_OUT),$SOFT,$DEADLINE)"
call "$LENS" "getPositions(address)((bytes32,uint8,uint256,uint256,uint256,uint256,uint256,uint256,bool)[])" "$USER"
COLLATERAL=$(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "$MARKET" "$USER" | sed -n '3p' | awk '{print $1}')

quote "$STOCK" "$USDC" "$COLLATERAL"
BACK=$(built "d['amountOut']")
MIN_BACK=$(python3 -c "print($BACK * 9900 // 10000)")
MAX=$(cast max-uint)
BEFORE=$(call "$USDC" "balanceOf(address)(uint256)" "$USER" | awk '{print $1}')
echo "Closing long: selling $COLLATERAL stock, expected USDC $BACK"
send "$ROUTER" "closeLong((bytes32,uint256,uint256,uint256,(address,bytes,uint256),uint256,uint256))" \
  "($MARKET,$MAX,$MAX,$MAX,($(built "d['routerAddress']"),$(built "d['data']"),$MIN_BACK),0,$DEADLINE)"
AFTER=$(call "$USDC" "balanceOf(address)(uint256)" "$USER" | awk '{print $1}')

echo "Returned to the user: $((AFTER - BEFORE)) USDC base units for a margin of $MARGIN"
echo "Router balances after: USDC $(call "$USDC" "balanceOf(address)(uint256)" "$ROUTER"), stock $(call "$STOCK" "balanceOf(address)(uint256)" "$ROUTER")"
echo "Position after: $(call "$LENS" "getPositions(address)((bytes32,uint8,uint256,uint256,uint256,uint256,uint256,uint256,bool)[])" "$USER")"
