#!/bin/sh
set -eu
umask 077

: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD:?}"
: "${B2_ACCOUNT_ID:?}"
: "${B2_ACCOUNT_KEY:?}"
: "${HEARTBEAT_URL:?}"

lock=/tmp/whatsapp-backup.flock
# Kernel locks are released when a job dies. A directory lock can survive an
# interrupted container process and block every later backup indefinitely.
exec 9>"$lock"
if ! flock -n 9; then
  echo "WhatsApp backup already running" >&2
  exit 1
fi
snapshot=/tmp/whatsapp-backup/whatsapp-mcp
command_pid=
cleanup() {
  # A child can inherit fd 9 and keep the flock alive after the shell exits.
  # Stop the timeout supervisor, which also terminates its command's group.
  if [ -n "$command_pid" ]; then
    kill -TERM "$command_pid" 2>/dev/null || true
    wait "$command_pid" 2>/dev/null || true
  fi
  rm -rf /tmp/whatsapp-backup
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
rm -rf /tmp/whatsapp-backup
mkdir -p "$snapshot/storages" "$snapshot/statics"

run_bounded() {
  duration=$1
  shift
  timeout --kill-after=30s "$duration" "$@" &
  command_pid=$!
  if wait "$command_pid"; then
    command_status=0
  else
    command_status=$?
  fi
  command_pid=
  return "$command_status"
}

run_restic() {
  restic_attempt=1
  while [ "$restic_attempt" -le 3 ]; do
    if run_bounded 5m restic "$@"; then
      return 0
    else
      restic_status=$?
    fi
    echo "restic $1 failed (exit $restic_status, attempt $restic_attempt/3)" >&2
    [ "$restic_attempt" -ge 3 ] || sleep 10
    restic_attempt=$((restic_attempt + 1))
  done
  return "$restic_status"
}

# The SQLite online backup command includes committed WAL transactions without
# copying a live database and WAL as unrelated files.
backup_database() {
  database=$1
  destination=$2
  sqlite_attempt=1
  while ! run_bounded 60s sqlite3 -cmd '.timeout 30000' "$database" ".backup '$destination'"; do
    [ "$sqlite_attempt" -lt 5 ] || return 1
    echo "SQLite backup busy or failed; retrying ($sqlite_attempt/5)" >&2
    sqlite_attempt=$((sqlite_attempt + 1))
    sleep 5
  done
}
backup_database /app/data/storages/whatsapp.db "$snapshot/storages/whatsapp.db"
backup_database /app/data/storages/chatstorage.db "$snapshot/storages/chatstorage.db"
test "$(sqlite3 "$snapshot/storages/whatsapp.db" 'PRAGMA quick_check;')" = ok
test "$(sqlite3 "$snapshot/storages/chatstorage.db" 'PRAGMA quick_check;')" = ok

# Preserve other runtime state and media. The two live DBs and their WAL files
# are excluded because the consistent copies above are the restore sources.
for path in /app/data/storages/* /app/data/storages/.[!.]*; do
  [ -e "$path" ] || continue
  case "${path##*/}" in
    *.db|*.db-wal|*.db-shm) continue ;;
  esac
  cp -a "$path" "$snapshot/storages/"
done
cp -a /app/data/statics/. "$snapshot/statics/"

# Network and authentication errors do not establish a missing repository.
echo "Checking restic repository"
run_restic cat config >/dev/null
echo "Saving WhatsApp backup"
run_restic backup --host whatsapp-mcp --tag whatsapp-mcp "$snapshot"
# Container hostnames change on deployment. Group by the fixed backup path so
# retention also includes snapshots from earlier container instances.
run_restic forget --tag whatsapp-mcp --group-by paths \
  --keep-last 10 --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

# Keep the push monitor silent on failure; a missed heartbeat alerts through Kuma.
printf 'url = "%s"\n' "$HEARTBEAT_URL" | curl --config - --fail --silent --show-error \
  --connect-timeout 10 --max-time 30 --output /dev/null
echo "WhatsApp backup completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
