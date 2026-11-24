#!/usr/bin/env bash
# Daily database backup (BE-53): a pg_dump custom-format file, 14 kept on the server, each one copied off it.
# Run by cron/levra-backup. The off-site copy uses rclone when LEVRA_BACKUP_REMOTE is set in env/backup.env
# (for example LEVRA_BACKUP_REMOTE=r2:levra-backups, with the rclone remote configured for the levra user).
# Every run, good or bad, is recorded in backup_runs; a backup without an off-site copy counts as failed.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
. deploy/backup-common.sh
keep="${LEVRA_BACKUP_KEEP:-14}"
file="$backups/levra-$(date -u +%Y%m%dT%H%M%SZ).dump"

fail() {
  trap - ERR
  echo "backup FAILED: $1" >&2
  rm -f "$file.partial"
  record_run backup false "$1" '{}'
  exit 1
}
trap 'fail "this step failed: $BASH_COMMAND"' ERR

install -d -m 0700 "$backups"
compose exec -T postgres pg_dump -U levra -d levra --format=custom --no-owner --no-privileges >"$file.partial" ||
  fail "pg_dump failed (is the postgres container up?)"
mv "$file.partial" "$file"
chmod 0600 "$file"
bytes=$(stat -c %s "$file")
echo "backup $file ($bytes bytes)"

ls -1 "$backups"/levra-*.dump | sort | head -n "-$keep" | xargs -r rm --

ok=true
error=""
offsite=false
if [ -n "${LEVRA_BACKUP_REMOTE:-}" ]; then
  rclone copy "$file" "$LEVRA_BACKUP_REMOTE/" || fail "$(basename "$file") could not be copied to $LEVRA_BACKUP_REMOTE"
  offsite=true
  echo "copied to $LEVRA_BACKUP_REMOTE"
else
  ok=false
  error="$(basename "$file") exists on this server only: LEVRA_BACKUP_REMOTE is not set"
  echo "$error" >&2
fi
record_run backup "$ok" "$error" "{\"file\":\"$(basename "$file")\",\"bytes\":$bytes,\"offsite\":$offsite}"
if [ "$ok" != true ]; then exit 1; fi
