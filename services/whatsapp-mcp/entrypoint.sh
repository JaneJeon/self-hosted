#!/bin/sh
set -eu

# One volume contains all mutable WhatsApp state. The image keeps only symlinks
# at the paths expected by the unchanged upstream binary.
mkdir -p /app/data/storages /app/data/statics/qrcode /app/data/statics/senditems /app/data/statics/media

: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD:?}"
: "${B2_ACCOUNT_ID:?}"
: "${B2_ACCOUNT_KEY:?}"
: "${HEARTBEAT_URL:?}"

# An empty first boot would create a new unpaired device. Stay alive so Railway
# can accept volume uploads, but do not start Go until the final snapshot has
# been copied and the operator uploads the marker as the very last file.
trap 'exit 0' INT TERM
echo "Waiting for migrated WhatsApp state in /app/data"
until [ -f /app/data/.migration-ready ] \
  && [ -s /app/data/storages/whatsapp.db ] \
  && [ -s /app/data/storages/chatstorage.db ]; do
  sleep 5
done
chown -R gowauser:gowa /app/data

# GOWA prints Viper settings at startup. Pass only non-secret values to it.
host=${WHATSAPP_MCP_HOST:-${RAILWAY_PRIVATE_DOMAIN:-127.0.0.1}}
# Upstream uses this name for both its listener and advertised SSE endpoint.
# During a Railway rollout, service DNS can still name the previous container.
# Bind the advertised name to this container's own address locally; other
# containers continue to discover it through Railway DNS.
if [ -n "${RAILWAY_PRIVATE_DOMAIN:-}" ] && [ "$host" = "$RAILWAY_PRIVATE_DOMAIN" ]; then
  own_address=$(getent hosts "$HOSTNAME" | awk 'NR == 1 { print $1 }')
  test -n "$own_address"
  printf '%s %s\n' "$own_address" "$host" >> /etc/hosts
fi

/usr/local/bin/backup-loop.sh &
backup_pid=$!

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
