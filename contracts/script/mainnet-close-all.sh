#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# closes every open position of the wallet and redeems its shares of the USDC vault.
# Used after a demo. Seed lending to the markets is left in place. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."

for symbol in QQQ HOOD BIL; do
  for side in long short; do
    SYMBOL=$symbol SIDE=$side ./script/mainnet-close.sh
  done
done

source script/mainnet-lib.sh
VAULT=$(field "d.get('usdcVault') or ''")
SHARES=0
if [ -n "$VAULT" ]; then
  SHARES=$(call "$VAULT" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
fi
if [ "$SHARES" = "0" ]; then
  echo "USDC vault: no shares"
  exit 0
fi
echo "USDC vault: $SHARES shares"
preflight 0 "redeeming the vault shares"
BEFORE=$(usdc_balance)
tx "Redeem all vault shares" "$VAULT" "redeem(uint256,address,address)" "$SHARES" "$ACCOUNT" "$ACCOUNT"
echo "Returned to the account: $(( $(usdc_balance) - BEFORE )) USDC base units"
