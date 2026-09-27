#!/bin/sh
set -eu

# One volume contains all mutable WhatsApp state. The image keeps only symlinks
# at the paths expected by the unchanged upstream binary.
mkdir -p /app/data/storages /app/data/statics/qrcode /app/data/statics/senditems /app/data/statics/media
chown -R gowauser:gowa /app/data

# An empty first boot would create a new unpaired device state in the volume.
# Wait for the consistent Mac snapshot and backup configuration instead.
test -s /app/data/storages/whatsapp.db
test -s /app/data/storages/chatstorage.db
: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD:?}"
: "${B2_ACCOUNT_ID:?}"
: "${B2_ACCOUNT_KEY:?}"
: "${HEARTBEAT_URL:?}"

/usr/local/bin/backup-loop.sh &
backup_pid=$!

# GOWA prints Viper settings at startup. Pass only non-secret values to it.
host=${WHATSAPP_MCP_HOST:-${RAILWAY_PRIVATE_DOMAIN:-127.0.0.1}}
su-exec gowauser env -i \
  HOME=/app \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  TZ=UTC \
  /app/whatsapp mcp --host "$host" --port 8080 &
server_pid=$!

trap 'kill -TERM "$server_pid" "$backup_pid" 2>/dev/null || true' INT TERM
if wait "$server_pid"; then
  server_status=0
else
  server_status=$?
fi
kill -TERM "$backup_pid" 2>/dev/null || true
wait "$backup_pid" 2>/dev/null || true
exit "$server_status"
