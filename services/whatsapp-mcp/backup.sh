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
trap 'rm -rf /tmp/whatsapp-backup' EXIT
rm -rf /tmp/whatsapp-backup
mkdir -p "$snapshot/storages" "$snapshot/statics"

# The SQLite online backup command includes committed WAL transactions without
# copying a live database and WAL as unrelated files.
backup_database() {
  database=$1
  destination=$2
  attempt=1
  while ! sqlite3 -cmd '.timeout 30000' "$database" ".backup '$destination'"; do
    [ "$attempt" -lt 5 ] || return 1
    echo "SQLite backup busy or failed; retrying ($attempt/5)" >&2
    attempt=$((attempt + 1))
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

if ! restic snapshots >/dev/null 2>&1; then
  restic init
fi
restic backup --host whatsapp-mcp --tag whatsapp-mcp "$snapshot"
# Container hostnames change on deployment. Group by the fixed backup path so
# retention also includes snapshots from earlier container instances.
restic forget --tag whatsapp-mcp --group-by paths \
  --keep-last 10 --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

# Keep the push monitor silent on failure; a missed heartbeat alerts through Kuma.
printf 'url = "%s"\n' "$HEARTBEAT_URL" | curl --config - --fail --silent --show-error --output /dev/null
echo "WhatsApp backup completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
