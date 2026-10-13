#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet, for every market in scope:
# a long on QQQ, HOOD and BIL, then a short on QQQ and HOOD. Each is opened and closed.
# Needs deployments/monad.json (make deploy-monad) and DEPLOYER_PRIVATE_KEY. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."

LONGS=${LONGS:-"QQQ HOOD BIL"}
SHORTS=${SHORTS:-"QQQ HOOD"}

for symbol in $LONGS; do
  echo
  echo "===== $symbol long ====="
  SYMBOL=$symbol ./script/mainnet-first-long.sh
done
for symbol in $SHORTS; do
  echo
  echo "===== $symbol short ====="
  SYMBOL=$symbol ./script/mainnet-first-short.sh
done
