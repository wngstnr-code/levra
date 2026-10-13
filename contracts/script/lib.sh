#!/usr/bin/env bash
# Shared helpers for the end-to-end scripts. They run against a local fork with the contracts deployed.

RPC=${FORK_RPC:-http://127.0.0.1:8545}
KEY=${FORK_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}
DEPLOYMENT=${DEPLOYMENT:-deployments/fork.json}

MORPHO=0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee
IRM=0x09475a3D6eA8c314c592b1a3799bDE044E2F400F
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
# The stock the script works on: QQQ, HOOD or BIL.
SYMBOL=${SYMBOL:-QQQ}
case "$SYMBOL" in
  QQQ) STOCK=0x1446501E886c7f830DB9b494A1890cBCCC072f57 ;;
  HOOD) STOCK=0x5a4860adDCc094FcE026384caeEcb1e634DD9af4 ;;
  BIL) STOCK=0x4FC5B9f8933597D3ecf84d0611687E1Dc8DD576f ;;
  *) echo "Unknown SYMBOL $SYMBOL. Use QQQ, HOOD or BIL." >&2; exit 1 ;;
esac
KYBER=https://aggregator-api.kyberswap.com/monad/api/v1
MAX=$(cast max-uint)
# Trades on the fork move its pools away from the live state the quotes come from, so allow more room.
SLIPPAGE_BPS=${SLIPPAGE_BPS:-500}

field() { python3 -c "import json; d=json.load(open('$DEPLOYMENT')); print($1)"; }
has_market() { [ "$(field "len([m for m in d['markets'] if m['symbol']=='$SYMBOL' and m['side']=='$1'])")" = "1" ]; }
market() {
  has_market "$1" || { echo "There is no $1 market for $SYMBOL in $DEPLOYMENT." >&2; exit 1; }
  field "[m for m in d['markets'] if m['symbol']=='$SYMBOL' and m['side']=='$1'][0]['$2']"
}
# Morpho market parameters: (loan token, collateral token, oracle, rate model, hard limit).
market_params() {
  if [ "$1" = "long" ]; then echo "($USDC,$STOCK,$(market long oracle),$IRM,$(market long lltv))"
  else echo "($STOCK,$USDC,$(market short oracle),$IRM,$(market short lltv))"; fi
}

ROUTER=$(field "d['router']")
LENS=$(field "d['lens']")
RISK=$(field "d['riskManager']")
ACCOUNT=$(cast wallet address --private-key "$KEY")

# Sends a transaction and fails loudly if it reverts. Prints the transaction hash.
# The gas limit is the estimate plus a margin: the router's nested calls (flash loan, callback, swap)
# can run out of gas when sent with the bare estimate.
GAS_MARGIN_PERCENT=${GAS_MARGIN_PERCENT:-150}
send_as() {
  local key=$1 from=$2
  shift 2
  local estimate
  estimate=$(cast estimate --rpc-url "$RPC" --from "$from" "$@")
  cast send --rpc-url "$RPC" --private-key "$key" --gas-limit $((estimate * GAS_MARGIN_PERCENT / 100)) --json "$@" | python3 -c "
import json, sys
receipt = json.load(sys.stdin)
if receipt.get('status') not in ('0x1', 1, '1'):
    sys.exit('Transaction reverted: ' + receipt.get('transactionHash', '?'))
print(receipt['transactionHash'])"
}
send() { send_as "$KEY" "$ACCOUNT" "$@" >/dev/null; }
call() { cast call --rpc-url "$RPC" "$@"; }
first() { awk '{print $1}'; }
now() { cast block --rpc-url "$RPC" latest -f timestamp; }
price_e8() { call "$1" "snapshot()(uint256,uint256,uint256,uint8,uint64,uint64,bool)" | sed -n '1p' | first; }
ltv() { call "$RISK" "positionLtv(bytes32,address)(uint256)" "$1" "$ACCOUNT" | first; }
positions() {
  call "$LENS" "getPositions(address)((bytes32,uint8,uint256,uint256,uint256,uint256,uint256,uint256,bool)[])" "$ACCOUNT"
}

# Asks KyberSwap for a route and for calldata where `taker` is both sender and recipient.
quote() {
  local token_in=$1 token_out=$2 amount=$3 taker=$4
  curl -s -H "x-client-id: levra" "$KYBER/routes?tokenIn=$token_in&tokenOut=$token_out&amountIn=$amount" > /tmp/levra-route.json
  python3 - "$taker" "$SLIPPAGE_BPS" <<'PY' > /tmp/levra-build-body.json
import json, sys
route = json.load(open("/tmp/levra-route.json"))["data"]["routeSummary"]
print(json.dumps({"routeSummary": route, "sender": sys.argv[1], "recipient": sys.argv[1], "slippageTolerance": int(sys.argv[2])}))
PY
  curl -s -X POST -H "content-type: application/json" -H "x-client-id: levra" --data @/tmp/levra-build-body.json "$KYBER/route/build" > /tmp/levra-build.json
}
built() { python3 -c "import json; d=json.load(open('/tmp/levra-build.json'))['data']; print($1)"; }
swap_tuple() { echo "($(built "d['routerAddress']"),$(built "d['data']"),$1)"; }
min_of() { python3 -c "print($1 * (10000 - $SLIPPAGE_BPS) // 10000)"; }

# Gives an address USDC taken from Morpho's idle balance. Only possible on a fork.
fund_usdc_to() {
  cast rpc --rpc-url "$RPC" anvil_impersonateAccount "$MORPHO" >/dev/null
  cast rpc --rpc-url "$RPC" anvil_setBalance "$MORPHO" 0x56BC75E2D63100000 >/dev/null
  cast send --rpc-url "$RPC" --from "$MORPHO" --unlocked "$USDC" "transfer(address,uint256)" "$1" "$2" >/dev/null
  cast rpc --rpc-url "$RPC" anvil_stopImpersonatingAccount "$MORPHO" >/dev/null
}
fund_usdc() { fund_usdc_to "$ACCOUNT" "$1"; }

# A second fork-only account that lends stock. KyberSwap refuses to build calldata for the
# well-known first account of a local node, so swaps taken directly by a wallet use this one.
LENDER_KEY=$(cast keccak "levra fork lender")
LENDER=$(cast wallet address --private-key "$LENDER_KEY")
lender_send() { send_as "$LENDER_KEY" "$LENDER" "$@" >/dev/null; }

authorize_router() {
  if [ "$(call "$MORPHO" "isAuthorized(address,address)(bool)" "$ACCOUNT" "$ROUTER")" != "true" ]; then
    send "$MORPHO" "setAuthorization(address,bool)" "$ROUTER" true
  fi
}
router_balances() {
  echo "USDC $(call "$USDC" "balanceOf(address)(uint256)" "$ROUTER" | first), stock $(call "$STOCK" "balanceOf(address)(uint256)" "$ROUTER" | first)"
}

# Finds how much USDC buys back a stock debt. Swaps take an exact input, and the exchange price can sit
# well above the oracle price (aHOOD has traded about 7% above), so the size comes from the quote itself.
# Sets SPEND and BOUGHT, and leaves the matching quote ready for swap_tuple.
quote_buyback() {
  local debt=$1 price=$2 taker=$3
  SPEND=$(python3 -c "print($debt * $price // 10**20 * 104 // 100)")
  for _ in 1 2 3 4; do
    quote "$USDC" "$STOCK" "$SPEND" "$taker"
    BOUGHT=$(built "d['amountOut']")
    if python3 -c "import sys; sys.exit(0 if $(min_of "$BOUGHT") > $debt else 1)"; then return 0; fi
    SPEND=$(python3 -c "print($SPEND * $debt * 103 // ($(min_of "$BOUGHT") * 100) + 1)")
  done
  echo "Could not find a buy-back size that covers the debt." >&2
  return 1
}
