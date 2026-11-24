#!/usr/bin/env bash
# The X Layer TapeOut run (BE-82, D-113) with the key in ${LEVRA_HOME}/secrets/tapeout/TAPEOUT_KEY. The key never
# leaves the server. It runs in a one-off container of the deployed image, with no other secrets mounted, so the
# running services are not touched.
#   deploy/tapeout.sh            plan and cost only, sends nothing
#   deploy/tapeout.sh --confirm  sends; a second run reads the state file and skips what is done
set -euo pipefail

cd "$(dirname "$0")/.."
home="${LEVRA_HOME:-/opt/levra}"
keys="$home/secrets/tapeout"
state="$home/tapeout"
image="levra-backend:$(git rev-parse --short=12 HEAD)"

if [ ! -d "$keys" ] || [ ! -d "$state" ]; then
  echo "Make the folders first (as root): install -d -m 0700 -o 1000 -g 1000 $keys $state" >&2
  exit 1
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "$image is not built. Run deploy/deploy.sh first." >&2
  exit 1
fi

docker run --rm \
  -v "$keys:/keys:ro" -v "$state:/state" -w /app/packages/tapeout \
  -e XLAYER_RPC_URL="${XLAYER_RPC_URL:-https://rpc.xlayer.tech}" \
  "$image" node_modules/.bin/tsx scripts/xlayer-run.ts --key-file /keys/TAPEOUT_KEY --state /state/tapeout-xlayer.json "$@"
