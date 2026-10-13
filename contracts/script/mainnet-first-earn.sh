#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the deployer wallet:
# deposits USDC into the Levra USDC vault, shows which market it reached, and withdraws it again.
# Needs the vault in deployments/monad.json (make deploy-vault-monad) and DEPLOYER_PRIVATE_KEY. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."
source script/mainnet-lib.sh

AMOUNT=${AMOUNT:-1000000}
WITHDRAW=${WITHDRAW:-yes}
VAULT=$(field "d.get('usdcVault') or ''")
if [ -z "$VAULT" ]; then
  echo "There is no usdcVault in $DEPLOYMENT." >&2
  exit 1
fi

vault_supply() {
  for entry in $(field "' '.join(m['symbol'] + ':' + m['marketId'] for m in d['markets'] if m['side'] == 'long')"); do
    echo "  ${entry%%:*} long market: $(call "$MORPHO" "position(bytes32,address)(uint256,uint128,uint128)" "${entry##*:}" "$VAULT" | sed -n '1p' | first) supply shares"
  done
}

preflight "$AMOUNT" "deposit into the USDC vault $VAULT"

tx "Approve USDC to the vault" "$USDC" "approve(address,uint256)" "$VAULT" "$AMOUNT"
tx "Deposit $AMOUNT USDC into the vault" "$VAULT" "deposit(uint256,address)" "$AMOUNT" "$ACCOUNT"
SHARES=$(call "$VAULT" "balanceOf(address)(uint256)" "$ACCOUNT" | first)
echo "Vault shares received: $SHARES. Vault total assets: $(call "$VAULT" "totalAssets()(uint256)" | first)"
echo "Where the vault holds it on Morpho:"
vault_supply

if [ "$WITHDRAW" = "yes" ]; then
  BEFORE=$(usdc_balance)
  tx "Redeem all vault shares" "$VAULT" "redeem(uint256,address,address)" "$SHARES" "$ACCOUNT" "$ACCOUNT"
  echo "Returned to the account: $(( $(usdc_balance) - BEFORE )) USDC base units for a deposit of $AMOUNT"
  echo "Vault total assets after: $(call "$VAULT" "totalAssets()(uint256)" | first)"
fi
