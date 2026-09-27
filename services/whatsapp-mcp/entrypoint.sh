#!/bin/sh
set -eu

# One volume contains all mutable WhatsApp state. The image keeps only symlinks
# at the paths expected by the unchanged upstream binary.
mkdir -p /app/data/storages /app/data/statics/qrcode /app/data/statics/senditems /app/data/statics/media
chown -R gowauser:gowa /app/data

# GOWA prints Viper settings at startup. Pass only non-secret values to it.
host=${WHATSAPP_MCP_HOST:-${RAILWAY_PRIVATE_DOMAIN:-127.0.0.1}}
exec su-exec gowauser env -i \
  HOME=/app \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  TZ=UTC \
  /app/whatsapp mcp --host "$host" --port 8080
