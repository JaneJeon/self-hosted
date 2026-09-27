#!/bin/sh
set -eu
umask 077

: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD:?}"
: "${B2_ACCOUNT_ID:?}"
: "${B2_ACCOUNT_KEY:?}"
: "${HEARTBEAT_URL:?}"

lock=/tmp/whatsapp-backup.lock
if ! mkdir "$lock" 2>/dev/null; then
  echo "WhatsApp backup already running" >&2
  exit 1
fi
snapshot=/tmp/whatsapp-backup/whatsapp-mcp
trap 'rm -rf /tmp/whatsapp-backup "$lock"' EXIT
rm -rf /tmp/whatsapp-backup
mkdir -p "$snapshot/storages" "$snapshot/statics"

# The SQLite online backup command includes committed WAL transactions without
# copying a live database and WAL as unrelated files.
sqlite3 /app/data/storages/whatsapp.db ".backup '$snapshot/storages/whatsapp.db'"
sqlite3 /app/data/storages/chatstorage.db ".backup '$snapshot/storages/chatstorage.db'"
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
restic backup --tag whatsapp-mcp "$snapshot"
restic forget --keep-last 10 --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

# Keep the push monitor silent on failure; a missed heartbeat alerts through Kuma.
printf 'url = "%s"\n' "$HEARTBEAT_URL" | curl --config - --fail --silent --show-error --output /dev/null
echo "WhatsApp backup completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
