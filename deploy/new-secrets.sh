#!/usr/bin/env bash
# Writes the secrets that are made on the server: the database password, every DATABASE_URL and AUTH_SECRET.
# Nothing is printed. An existing file is kept, so running it again is safe.
#   deploy/new-secrets.sh
set -euo pipefail

home="${LEVRA_HOME:-/opt/levra}"
secrets="$home/secrets"
owner="${LEVRA_SECRET_UID:-1000}"

write_secret() {
  local dir="$secrets/$1" name="$2" value="$3"
  install -d -m 0700 -o "$owner" -g "$owner" "$dir"
  if [ -e "$dir/$name" ]; then
    echo "kept   $1/$name"
    return
  fi
  (umask 0377 && printf '%s' "$value" >"$dir/$name")
  chown "$owner:$owner" "$dir/$name"
  echo "wrote  $1/$name"
}

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ -e "$secrets/postgres/POSTGRES_PASSWORD" ]; then
  password=$(cat "$secrets/postgres/POSTGRES_PASSWORD")
else
  # Hex only, so the password needs no encoding inside a URL.
  password=$(random_hex 24)
fi
write_secret postgres POSTGRES_PASSWORD "$password"

url="postgres://levra:${password}@postgres:5432/levra"
for service in migrate api indexer-monad keeper-monad keeper-base keeper-xlayer; do
  write_secret "$service" DATABASE_URL "$url"
done

write_secret api AUTH_SECRET "$(random_hex 32)"
unset password url
