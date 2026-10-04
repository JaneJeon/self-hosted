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

# The password is already in the runtime environment. Keep it out of the
# mysqldump argument list, including on retries.
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"

# A B2 request can keep retrying inside restic without returning to the shell.
# End each attempt so a fresh process can reconnect and the daily cron can exit.
run_restic() {
  local attempt exit_code
  for attempt in 1 2 3; do
    if timeout --kill-after=30s 5m restic "$@"; then
      return 0
    else
      exit_code=$?
    fi
    log "restic $1 failed (exit ${exit_code}, attempt ${attempt}/3)" >&2
    if [[ "$attempt" -lt 3 ]]; then
      sleep 10
    fi
  done
  return "$exit_code"
}

log "Checking restic repository..."
# A connection failure is not evidence that the repository is missing. Create
# new repositories explicitly, and leave diagnostic errors on stderr.
run_restic cat config > /dev/null

log "Dumping all databases and streaming to restic..."
run_restic backup \
  --stdin-from-command \
  --stdin-filename all-databases.sql \
  --tag mysql \
  -- mysqldump \
       --ssl-mode=DISABLED \
       --get-server-public-key \
       --single-transaction \
       --lock-tables=false \
       -h "${MYSQL_HOST}" \
       -u root \
       --all-databases

log "Applying retention policy (keep-last 10, daily 7, weekly 5, monthly 12)..."
run_restic forget --keep-last 10 --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune

log "=== Backup complete ==="
if [[ -n "${HEARTBEAT_URL:-}" ]]; then
  printf 'url = "%s"\n' "$HEARTBEAT_URL" | \
    curl --config - --fail --silent --show-error \
      --connect-timeout 10 --max-time 30 --output /dev/null
  log "Heartbeat sent"
fi
