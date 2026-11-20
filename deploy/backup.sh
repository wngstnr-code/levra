#!/usr/bin/env bash
# Daily database backup (BE-53): a pg_dump custom-format file, 14 kept on the server, each one copied off it.
# Run by cron/levra-backup. The off-site copy uses rclone when LEVRA_BACKUP_REMOTE is set in env/backup.env
# (for example LEVRA_BACKUP_REMOTE=r2:levra-backups, with the rclone remote configured for the levra user).
set -euo pipefail

cd "$(dirname "$0")/.."
settings="${LEVRA_HOME:-/opt/levra}/env/backup.env"
if [ -f "$settings" ]; then
  set -a
  . "$settings"
  set +a
fi
backups="${LEVRA_HOME:-/opt/levra}/backups"
keep="${LEVRA_BACKUP_KEEP:-14}"
file="$backups/levra-$(date -u +%Y%m%dT%H%M%SZ).dump"

install -d -m 0700 "$backups"
# Inside the container pg_dump connects over the local socket, which needs no password.
docker compose -f deploy/compose.yml exec -T postgres pg_dump -U levra -d levra --format=custom --no-owner --no-privileges >"$file.partial"
mv "$file.partial" "$file"
chmod 0600 "$file"
echo "backup $file ($(stat -c %s "$file") bytes)"

ls -1 "$backups"/levra-*.dump | sort | head -n "-$keep" | xargs -r rm --
if [ -n "${LEVRA_BACKUP_REMOTE:-}" ]; then
  rclone copy "$file" "$LEVRA_BACKUP_REMOTE/"
  echo "copied to $LEVRA_BACKUP_REMOTE"
else
  echo "LEVRA_BACKUP_REMOTE is not set: this backup exists on this server only" >&2
fi
