#!/usr/bin/env bash
# Deploys a commit of the backend on the VPS (docs/hosting.md). Run as the levra user from /opt/levra/app.
#   deploy/deploy.sh            deploys origin/main
#   deploy/deploy.sh <commit>   deploys that commit (also the way to roll back; migrations cannot be undone)
set -euo pipefail

# Everything runs inside main, so bash has read the whole file before the checkout below replaces it.
main() {
  cd "$(dirname "$0")/.."
  ref="${1:-origin/main}"

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "The checkout has local changes. Commit them in the repo instead of editing the server." >&2
    exit 1
  fi

  git fetch --prune origin
  git checkout --quiet --detach "$ref"
  # Run this commit's own deploy script: the one bash has read belongs to the commit checked out before.
  if [ -z "${LEVRA_DEPLOY_SELF:-}" ]; then
    LEVRA_DEPLOY_SELF=1 exec deploy/deploy.sh "$(git rev-parse HEAD)"
  fi

  # Every service in compose.yml reads an env file; name the missing ones before compose fails on the first.
  missing=0
  for example in deploy/env/*.env.example; do
    name=$(basename "$example" .example)
    if [ ! -f "${LEVRA_HOME:-/opt/levra}/env/$name" ]; then
      echo "missing ${LEVRA_HOME:-/opt/levra}/env/$name (copy $example and fill it in)" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1

  # Who may connect (caddy.env ORIGIN) and which headers the API believes (api.env) must change together (BE-52).
  env_value() { sed -n "s/^$2=//p" "${LEVRA_HOME:-/opt/levra}/env/$1" | tail -n 1 | tr -d "\"'\r" | tr '[:upper:]' '[:lower:]'; }
  origin=$(env_value caddy.env ORIGIN)
  origin=${origin:-open}
  trust=$(env_value api.env TRUST_PROXY_HEADER)
  country=$(env_value api.env GEO_COUNTRY_HEADER)
  region=$(env_value api.env GEO_REGION_HEADER)
  case "$origin" in
    open)
      for header in "$trust" "$country" "$region"; do
        case "$header" in cf-*)
          echo "api.env reads Cloudflare headers ($header), but caddy.env has ORIGIN=open, so anyone could send them. Set ORIGIN=cloudflare in the same deploy." >&2
          exit 1
          ;;
        esac
      done
      ;;
    cloudflare)
      if [ "$trust" != "cf-connecting-ip" ]; then
        echo "caddy.env has ORIGIN=cloudflare, so TRUST_PROXY_HEADER in api.env must be cf-connecting-ip; otherwise every visitor shares Cloudflare's address in the rate limit." >&2
        exit 1
      fi
      ;;
    *)
      echo "ORIGIN in caddy.env must be open or cloudflare, not $origin" >&2
      exit 1
      ;;
  esac
  # The agent passes the caller's address on under the header the API trusts (BE-77).
  agent_ip=$(env_value agent.env CLIENT_IP_HEADER)
  if [ "$agent_ip" != "$trust" ]; then
    echo "CLIENT_IP_HEADER in agent.env ($agent_ip) must equal TRUST_PROXY_HEADER in api.env ($trust); otherwise every agent caller shares one rate limit." >&2
    exit 1
  fi
  case "$(env_value agent.env LEVRA_API_URL)" in
    http://api:*) ;;
    *)
      echo "LEVRA_API_URL in agent.env must be the internal http://api:8787, never the public address (D-111)." >&2
      exit 1
      ;;
  esac

  APP_VERSION=$(git rev-parse --short=12 HEAD)
  export APP_VERSION
  echo "deploying $APP_VERSION"

  compose() { docker compose -f deploy/compose.yml "$@"; }

  # Every app service shares this one image; `compose build` would export and unpack it once per service, which filled
  # the disk on 25 November 2026.
  docker build -t "levra-backend:$APP_VERSION" --build-arg "APP_VERSION=$APP_VERSION" -f deploy/Dockerfile .
  # Check the Caddy config with the same image and env before the running Caddy sees it.
  docker run --rm --env-file "${LEVRA_HOME:-/opt/levra}/env/caddy.env" -v "$PWD/deploy/caddy:/etc/caddy:ro" caddy:2-alpine \
    caddy adapt --validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  # `up` runs migrate first and starts the apps only if it succeeds (depends_on in compose.yml).
  compose up -d --no-build --remove-orphans
  # `up` recreates Caddy only when its env or mounts change; a new Caddyfile alone needs a reload. A failed reload keeps the old config.
  for try in 1 2 3 4 5; do
    compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && break
    [ "$try" -lt 5 ] || exit 1
    sleep 2
  done

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
  # Each deploy tags a new image, which `image prune` never removes. Keep this one and the newest other (for a rollback
  # without a rebuild); an image a container still uses is refused by `rm` and stays.
  docker image ls levra-backend --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r | cut -f2 | grep -vx "$APP_VERSION" | tail -n +2 |
    sed 's/^/levra-backend:/' | xargs -r docker image rm >/dev/null 2>&1 || true
  docker image prune -f >/dev/null
  docker builder prune -f --filter "until=72h" >/dev/null
}

main "$@"
