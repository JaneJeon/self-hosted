#!/bin/bash
set -euo pipefail

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "=== MySQL backup starting ==="

: "${MYSQL_HOST:?}"
: "${MYSQL_ROOT_PASSWORD:?}"
: "${RESTIC_REPOSITORY:?}"
: "${RESTIC_PASSWORD:?}"
: "${B2_ACCOUNT_ID:?}"
: "${B2_ACCOUNT_KEY:?}"

log "Checking restic repository..."
restic snapshots &>/dev/null || {
  log "Repository not found — initializing..."
  restic init
}

log "Dumping all databases and streaming to restic..."
restic backup \
  --stdin-from-command \
  --stdin-filename all-databases.sql \
  --tag mysql \
  -- mysqldump \
       --skip-ssl \
       --single-transaction \
       --lock-tables=false \
       -h "${MYSQL_HOST}" \
       -u root \
       -p"${MYSQL_ROOT_PASSWORD}" \
       --all-databases

log "Applying retention policy (keep-last 10, daily 7, weekly 5, monthly 12)..."
restic forget --keep-last 10 --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

log "=== Backup complete ==="
if [[ -n "${HEARTBEAT_URL:-}" ]]; then
  curl -fsS "${HEARTBEAT_URL}" > /dev/null
  log "Heartbeat sent"
fi
