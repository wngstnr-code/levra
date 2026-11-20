#!/usr/bin/env bash
# Makes new role keys for a keeper on the server and writes them as its secret files (BE-55).
# The keys never leave the server; only the addresses and the owner calls are printed.
#   deploy/keys.sh keeper-monad ORACLE_AGE_POSTER_KEY CALENDAR_POSTER_KEY PROTECTOR_KEY LIQUIDATOR_KEY [--replace] [--confirm]
set -euo pipefail

cd "$(dirname "$0")/.."
service="${1:?name the keeper service, for example keeper-monad}"
shift
case "$service" in
  keeper-*) ;;
  *) echo "Only keeper services hold role keys." >&2; exit 1 ;;
esac

dir="${LEVRA_HOME:-/opt/levra}/secrets/$service"
if [ ! -d "$dir" ]; then
  echo "$dir does not exist. Run deploy/setup-server.sh and deploy/new-secrets.sh first." >&2
  exit 1
fi

docker compose -f deploy/compose.yml run --rm --no-deps \
  -v "$dir:/keys-out" \
  "$service" node_modules/.bin/tsx scripts/keys.ts --dir /keys-out "$@"
echo "Restart the keeper after the roles are granted: docker compose -f deploy/compose.yml restart $service"
