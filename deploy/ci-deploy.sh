#!/usr/bin/env bash
# The only command the CI deploy key may run (hosting.md, "Automatic deploy"). Installed as /opt/levra/bin/ci-deploy,
# outside the checkout, because deploy.sh replaces the checkout while it runs. Its one input is the commit to deploy,
# which sshd passes in SSH_ORIGINAL_COMMAND.
set -euo pipefail

main() {
  local app="${LEVRA_HOME:-/opt/levra}/app"
  local sha="${SSH_ORIGINAL_COMMAND:-${1:-}}"
  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "expected a full commit hash, got '${sha:0:80}'" >&2
    exit 2
  fi
  cd "$app"

  # One deploy at a time, also against a hand deploy started through this script.
  exec 9>"$app/.git/levra-deploy.lock"
  flock -w 1800 9 || { echo "another deploy is still running" >&2; exit 1; }

  git fetch --quiet --prune origin
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "$sha is not on main" >&2
    exit 1
  fi
  # A later commit may already be live (a newer run or a hand deploy). Never go back automatically.
  local current
  current=$(git rev-parse HEAD)
  if [ "$current" != "$sha" ] && git merge-base --is-ancestor "$sha" "$current"; then
    echo "$current is live and already includes $sha; nothing to deploy"
    exit 0
  fi
  deploy/deploy.sh "$sha"
}

main "$@"
