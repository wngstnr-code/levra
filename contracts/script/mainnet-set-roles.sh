#!/usr/bin/env bash
# Sends REAL transactions on Monad mainnet with the owner wallet: gives the operational roles to the
# addresses in the environment. A role whose variable is empty, or that already holds the address, is skipped.
#   KEEPER             runs auto-deleverage on the router
#   LIQUIDATOR_KEEPER  calls the Liquidator. Defaults to KEEPER
#   CALENDAR_POSTER    posts the next market close
#   ORACLE_AGE_POSTER  moves maxOracleAge inside the owner's bounds
# Keepers are added, not replaced: an earlier keeper stays until the owner removes it. A poster is replaced.
# Needs deployments/monad.json and DEPLOYER_PRIVATE_KEY, which must be the owner. Run with CONFIRM=yes.
set -euo pipefail
cd "$(dirname "$0")/.."
source script/mainnet-lib.sh

LIQUIDATOR=$(field "d['liquidator']")
LIQUIDATOR_KEEPER=${LIQUIDATOR_KEEPER:-${KEEPER:-}}
PLAN=()

same() { [ "$(tr '[:upper:]' '[:lower:]' <<<"$1")" = "$(tr '[:upper:]' '[:lower:]' <<<"$2")" ]; }
checked() { cast to-check-sum-address "$1"; }

plan_keeper() {
  local label=$1 target=$2 address=$3
  [ -n "$address" ] || return 0
  address=$(checked "$address")
  if [ "$(call "$target" "isKeeper(address)(bool)" "$address")" = "true" ]; then
    echo "$label: $address is already set"
  else
    PLAN+=("$label|$target|setKeeper(address,bool)|$address true")
  fi
}

plan_poster() {
  local label=$1 getter=$2 setter=$3 address=$4
  [ -n "$address" ] || return 0
  address=$(checked "$address")
  if same "$(call "$RISK" "$getter()(address)")" "$address"; then
    echo "$label: $address is already set"
  else
    PLAN+=("$label|$RISK|$setter(address)|$address")
  fi
}

for owned in "$ROUTER" "$RISK" "$LIQUIDATOR"; do
  if ! same "$(call "$owned" "owner()(address)")" "$ACCOUNT"; then
    echo "$ACCOUNT is not the owner of $owned." >&2
    exit 1
  fi
done

plan_keeper "Router keeper" "$ROUTER" "${KEEPER:-}"
plan_keeper "Liquidator keeper" "$LIQUIDATOR" "$LIQUIDATOR_KEEPER"
plan_poster "Calendar poster" calendarPoster setCalendarPoster "${CALENDAR_POSTER:-}"
plan_poster "Oracle age poster" oracleAgePoster setOracleAgePoster "${ORACLE_AGE_POSTER:-}"

if [ "${#PLAN[@]}" -eq 0 ]; then
  echo "Nothing to set. Fill in KEEPER, LIQUIDATOR_KEEPER, CALENDAR_POSTER or ORACLE_AGE_POSTER."
  exit 0
fi
for step in "${PLAN[@]}"; do
  IFS='|' read -r label _ _ arguments <<<"$step"
  echo "Will set: $label -> ${arguments%% *}"
done

preflight 0 "setting ${#PLAN[@]} roles"

for step in "${PLAN[@]}"; do
  IFS='|' read -r label target signature arguments <<<"$step"
  # shellcheck disable=SC2086
  tx "$label ${arguments%% *}" "$target" "$signature" $arguments
done
