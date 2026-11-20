#!/usr/bin/env bash
# Deploys a commit of the backend on the VPS (docs/hosting.md). Run as the levra user from /opt/levra/app.
#   deploy/deploy.sh            deploys origin/main
#   deploy/deploy.sh <commit>   deploys that commit (also the way to roll back; migrations cannot be undone)
set -euo pipefail

cd "$(dirname "$0")/.."
ref="${1:-origin/main}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "The checkout has local changes. Commit them in the repo instead of editing the server." >&2
  exit 1
fi

git fetch --prune origin
git checkout --quiet --detach "$ref"
APP_VERSION=$(git rev-parse --short=12 HEAD)
export APP_VERSION
echo "deploying $APP_VERSION"

compose() { docker compose -f deploy/compose.yml "$@"; }

compose build
# `up` runs migrate first and starts the apps only if it succeeds (depends_on in compose.yml).
compose up -d --remove-orphans

for _ in $(seq 1 40); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || true)
  if [ "$status" = "healthy" ]; then
    echo "api healthy"
    break
  fi
  sleep 3
done
if [ "${status:-}" != "healthy" ]; then
  echo "api is not healthy after two minutes:" >&2
  compose ps
  compose logs --tail 50 api migrate >&2
  exit 1
fi

compose exec -T api node -e "fetch('http://127.0.0.1:8787/v1/status').then(r=>r.json()).then(s=>console.log(JSON.stringify(s,null,2)))"
compose ps
docker image prune -f --filter "until=168h" >/dev/null
