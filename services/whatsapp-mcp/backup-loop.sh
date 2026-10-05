#!/bin/sh
set -u

marker=/app/data/storages/.whatsapp-backup-last-success
job_pid=
stop_job() {
  if [ -n "$job_pid" ]; then
    kill -TERM "$job_pid" 2>/dev/null || true
    wait "$job_pid" 2>/dev/null || true
  fi
  exit 0
}
trap stop_job INT TERM
while :; do
  now=$(date -u +%s)
  last=0
  if [ -f "$marker" ]; then
    read -r last < "$marker" || last=0
    case "$last" in
      ''|*[!0-9]*) last=0 ;;
    esac
  fi

  until_time=$((last + 86400))
  if [ "$now" -ge "$until_time" ]; then
    timeout --kill-after=30s 1h /usr/local/bin/backup.sh &
    job_pid=$!
    if wait "$job_pid"; then
      job_pid=
      date -u +%s > "$marker"
      sleep 300
    else
      job_pid=
      echo "WhatsApp backup failed; retrying in one hour" >&2
      sleep 3600
    fi
  else
    wait_seconds=$((until_time - now))
    [ "$wait_seconds" -le 900 ] || wait_seconds=900
    sleep "$wait_seconds"
  fi
done
