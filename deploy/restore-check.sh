#!/usr/bin/env bash
# Weekly restore check (BE-53): restores the newest dump into a scratch database inside the Postgres container and
# checks it. The dump must be at most 26 hours old, present in the off-site copy with the same size (when
# LEVRA_BACKUP_REMOTE is set), restore in one transaction without an error, and hold every table and migration of
# the live database. Row counts are printed, not compared: rows written after the dump and pruned tables make them
# differ. The result is recorded in backup_runs. Run by cron/levra-backup.
set -Eeuo pipefail

cd "$(dirname "$0")/.."
. deploy/backup-common.sh
scratch=levra_restore_check
started=$(date +%s)

fail() {
  trap - ERR
  echo "restore check FAILED: $1" >&2
  record_run restore_check false "$1" '{}'
  exit 1
}
drop_scratch() { db_psql levra -c "drop database if exists $scratch" >/dev/null || true; }
trap 'fail "this step failed: $BASH_COMMAND"' ERR
trap drop_scratch EXIT

latest=$( (ls -1 "$backups"/levra-*.dump 2>/dev/null || true) | sort | tail -n 1)
[ -n "$latest" ] || fail "no dump in $backups"
name=$(basename "$latest")
bytes=$(stat -c %s "$latest")
age_h=$((($(date +%s) - $(stat -c %Y "$latest")) / 3600))
[ "$age_h" -le 26 ] || fail "the newest dump $name is $age_h h old"

offsite=false
if [ -n "${LEVRA_BACKUP_REMOTE:-}" ]; then
  remote_bytes=$( (rclone lsl "$LEVRA_BACKUP_REMOTE/$name" 2>/dev/null || true) | awk 'NR == 1 { print $1 }')
  [ "$remote_bytes" = "$bytes" ] || fail "$name is missing from $LEVRA_BACKUP_REMOTE or has a different size there"
  offsite=true
fi

drop_scratch
db_psql levra -c "create database $scratch"
compose exec -T postgres pg_restore -U levra -d "$scratch" --no-owner --no-privileges --exit-on-error --single-transaction <"$latest" ||
  fail "pg_restore of $name failed"

# "schema.table rows" per line, sorted, for every table in the database (our schema and the migration log).
count_rows() {
  printf '%s\n' "select format('select %L, count(*) from %I.%I', table_schema || '.' || table_name, table_schema, table_name) from information_schema.tables where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE' order by 1 \gexec" |
    db_psql "$1" -F ' ' | LC_ALL=C sort
}
live=$(count_rows levra)
restored=$(count_rows "$scratch")

missing=$(LC_ALL=C comm -23 <(cut -d' ' -f1 <<<"$live") <(cut -d' ' -f1 <<<"$restored") | paste -sd, -)
[ -z "$missing" ] || fail "tables missing from the restored $name: $missing"
migrations() { awk '$1 == "drizzle.__drizzle_migrations" { print $2 }' <<<"$1"; }
[ "$(migrations "$live")" = "$(migrations "$restored")" ] ||
  fail "the restored $name has $(migrations "$restored") migrations, the live database $(migrations "$live"); a deploy ran after the dump, check again after the next backup"
tables=$(wc -l <<<"$restored")
rows=$(awk '{ s += $2 } END { print s + 0 }' <<<"$restored")
live_rows=$(awk '{ s += $2 } END { print s + 0 }' <<<"$live")
[ "$rows" -gt 0 ] || [ "$live_rows" -eq 0 ] || fail "the restored $name holds no rows"

seconds=$(($(date +%s) - started))
echo "restore check of $name ($bytes bytes, $age_h h old, off-site copy: $offsite) in $seconds s"
echo "table live restored"
LC_ALL=C join <(echo "$live") <(echo "$restored")
record_run restore_check true "" "{\"file\":\"$name\",\"bytes\":$bytes,\"ageHours\":$age_h,\"offsite\":$offsite,\"tables\":$tables,\"rows\":$rows,\"seconds\":$seconds}"
echo "restore check passed"
