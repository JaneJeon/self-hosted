#!/bin/sh
set -u

marker=/app/data/storages/.whatsapp-backup-last-success
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
    if /usr/local/bin/backup.sh; then
      date -u +%s > "$marker"
      sleep 300
    else
      echo "WhatsApp backup failed; retrying in one hour" >&2
      sleep 3600
    fi
  else
    wait_seconds=$((until_time - now))
    [ "$wait_seconds" -le 900 ] || wait_seconds=900
    sleep "$wait_seconds"
  fi
done
