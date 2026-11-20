#!/bin/sh
# Exports each file in /run/secrets as the variable of the same name, then starts the command.
# Secrets stay out of compose files, env files and `docker inspect` (docs/hosting.md).
set -eu

if [ -d /run/secrets ]; then
  for file in /run/secrets/*; do
    [ -f "$file" ] || continue
    name=$(basename "$file")
    case "$name" in
      [!A-Z_]* | *[!A-Z0-9_]*)
        echo "entrypoint: skipped secret file with a name that is not a variable name: $name" >&2
        continue
        ;;
    esac
    # Command substitution drops the trailing newline an editor may leave.
    value=$(cat "$file")
    export "$name=$value"
  done
fi

exec "$@"
