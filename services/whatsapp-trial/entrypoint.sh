#!/bin/sh
set -eu
umask 077
: "${WHATSAPP_CANDIDATE_READ_ONLY:?}"
test "$WHATSAPP_CANDIDATE_READ_ONLY" = 1
: "${WHATSAPP_TRIAL_SNAPSHOT:?}"
host=${WHATSAPP_MCP_HOST:-${RAILWAY_PRIVATE_DOMAIN:-127.0.0.1}}
trap 'exit 0' INT TERM
echo "Waiting for immutable WhatsApp trial snapshot; no bridge or backup is started"
until [ -f /app/data/.snapshot-ready ]; do sleep 2; done
# The runtime user can neither change the DBs nor create a journal beside them.
chown root:whatsapp /app/data /app/data/* /app/data/.snapshot-ready
chmod 0550 /app/data
chmod 0440 /app/data/* /app/data/.snapshot-ready
exec gosu whatsapp env -i HOME=/app PATH="$PATH" TZ=UTC \
  WHATSAPP_DB_PATH=/app/data/messages.db WHATSMEOW_DB_PATH=/app/data/contacts.db \
  WHATSAPP_CANDIDATE_READ_ONLY=1 WHATSAPP_TRIAL_SNAPSHOT="$WHATSAPP_TRIAL_SNAPSHOT" \
  WHATSAPP_MCP_HOST="$host" python3 /app/mcp/trial_serve.py
