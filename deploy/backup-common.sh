# Shared by backup.sh and restore-check.sh (BE-53). Sourced from the repo root, not run.
settings="${LEVRA_HOME:-/opt/levra}/env/backup.env"
if [ -f "$settings" ]; then
  set -a
  . "$settings"
  set +a
fi
backups="${LEVRA_HOME:-/opt/levra}/backups"

compose() { docker compose -f deploy/compose.yml "$@"; }

# Inside the container psql connects over the local socket, which needs no password.
db_psql() {
  local database="$1"
  shift
  compose exec -T postgres psql -U levra -d "$database" -v ON_ERROR_STOP=1 -q -At "$@"
}

# record_run <kind> <ok> <error> <details json>: one row in backup_runs, which the team monitor alerts from.
# Values go in as psql variables, so an error message cannot break the statement.
record_run() {
  printf '%s\n' "insert into backup_runs (kind, ok, error, details) values (:'kind', :'ok', nullif(:'err', ''), :'details'::jsonb);" |
    db_psql levra -v kind="$1" -v ok="$2" -v err="$3" -v details="$4" ||
    echo "could not record the $1 run in backup_runs" >&2
}
