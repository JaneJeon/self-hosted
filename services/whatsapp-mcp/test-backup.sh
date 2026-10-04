#!/bin/sh
set -eu

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin" /app/data/storages /app/data/statics/media
sqlite3 /app/data/storages/whatsapp.db "CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO fixture VALUES (1,'device');"
sqlite3 /app/data/storages/chatstorage.db "CREATE TABLE fixture (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO fixture VALUES (1,'chat');"
printf fixture > /app/data/statics/media/fixture

cat > "$test_root/bin/restic" <<'STUB'
#!/bin/sh
set -eu
operation=$1
printf '%s\n' "$operation" >> "$CASE_DIR/calls"
count=0
[ ! -f "$CASE_DIR/$operation" ] || read -r count < "$CASE_DIR/$operation"
count=$((count + 1))
printf '%s\n' "$count" > "$CASE_DIR/$operation"
case "$SCENARIO:$operation" in
  transient:cat)
    if [ "$count" -eq 1 ]; then echo 'fixture network error' >&2; exit 1; fi ;;
  stalled_once:cat)
    if [ "$count" -eq 1 ]; then /bin/sleep 30; fi ;;
  stalled:cat|interrupted:cat|loop_interrupted:cat)
    printf '%s\n' "$$" > "$CASE_DIR/active-restic"
    /bin/sleep 30 ;;
  missing:cat) echo 'fixture repository missing' >&2; exit 10 ;;
  backup_failed:backup) exit 1 ;;
  retention_failed:forget) exit 1 ;;
esac
STUB

cat > "$test_root/bin/timeout" <<'STUB'
#!/bin/sh
set -eu
[ "$1" = --kill-after=30s ]
duration=$2
shift 2
case "$duration" in
  5m) duration=1s ;;
  60s) duration=5s ;;
  1h) duration=10s ;;
  *) exit 99 ;;
esac
exec /usr/bin/timeout --kill-after=1s "$duration" "$@"
STUB

cat > "$test_root/bin/sleep" <<'STUB'
#!/bin/sh
case "$1" in
  5|10) exit 0 ;;
  *) /bin/sleep 30 ;;
esac
STUB

cat > "$test_root/bin/sqlite3" <<'STUB'
#!/bin/sh
if [ "$SCENARIO" = sqlite_failed ]; then exit 1; fi
exec /usr/bin/sqlite3 "$@"
STUB

cat > "$test_root/bin/curl" <<'STUB'
#!/bin/sh
set -eu
cat > "$CASE_DIR/heartbeat-config"
printf '%s\n' "$*" > "$CASE_DIR/curl-arguments"
touch "$CASE_DIR/heartbeat"
[ "$SCENARIO" != heartbeat_failed ]
STUB
chmod +x "$test_root/bin/"*

export PATH="$test_root/bin:$PATH"
export RESTIC_REPOSITORY=fixture RESTIC_PASSWORD=fixture
export B2_ACCOUNT_ID=fixture B2_ACCOUNT_KEY=fixture
export HEARTBEAT_URL='http://fixture/api/push/fixture-token?status=up'

run_case() {
  export SCENARIO=$1 CASE_DIR="$test_root/$1"
  mkdir -p "$CASE_DIR"
  exit_code=0
  /usr/local/bin/backup.sh > "$CASE_DIR/output" 2>&1 || exit_code=$?
  case "$SCENARIO" in
    success|transient|stalled_once)
      [ "$exit_code" -eq 0 ] && [ -f "$CASE_DIR/heartbeat" ]
      [ -f "$CASE_DIR/backup" ] && [ -f "$CASE_DIR/forget" ] ;;
    heartbeat_failed) [ "$exit_code" -ne 0 ] && [ -f "$CASE_DIR/heartbeat" ] ;;
    *) [ "$exit_code" -ne 0 ] && [ ! -f "$CASE_DIR/heartbeat" ] ;;
  esac
  case "$SCENARIO" in
    transient|stalled_once) [ "$(cat "$CASE_DIR/cat")" = 2 ] ;;
    stalled) [ "$exit_code" -eq 124 ] && [ "$(cat "$CASE_DIR/cat")" = 3 ] && [ ! -f "$CASE_DIR/backup" ] ;;
    missing) [ "$(cat "$CASE_DIR/cat")" = 3 ] && [ ! -f "$CASE_DIR/backup" ] ;;
    backup_failed) [ "$(cat "$CASE_DIR/backup")" = 3 ] && [ ! -f "$CASE_DIR/forget" ] ;;
    retention_failed) [ "$(cat "$CASE_DIR/forget")" = 3 ] ;;
    sqlite_failed) [ ! -f "$CASE_DIR/calls" ] ;;
  esac
  [ ! -d /tmp/whatsapp-backup ]
  flock -n /tmp/whatsapp-backup.flock true
  if [ -f "$CASE_DIR/calls" ]; then ! grep -qx init "$CASE_DIR/calls"; fi
  if [ -f "$CASE_DIR/curl-arguments" ]; then
    grep -q -- '--connect-timeout 10 --max-time 30' "$CASE_DIR/curl-arguments"
    ! grep -q fixture-token "$CASE_DIR/curl-arguments"
  fi
  echo "PASS $SCENARIO (exit $exit_code)"
}

for scenario in success transient stalled_once stalled missing sqlite_failed backup_failed retention_failed heartbeat_failed; do
  run_case "$scenario"
done

interruption_case() {
  export SCENARIO=$1 CASE_DIR="$test_root/$1"
  mkdir -p "$CASE_DIR"
  printf '0\n' > /app/data/storages/.whatsapp-backup-last-success
  "$2" > "$CASE_DIR/output" 2>&1 &
  parent_pid=$!
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    [ ! -f "$CASE_DIR/active-restic" ] || break
    /bin/sleep 0.1
  done
  read -r restic_pid < "$CASE_DIR/active-restic"
  # A second job must not remove the first one's staged snapshot.
  if /usr/local/bin/backup.sh >/dev/null 2>&1; then exit 1; fi
  [ -d /tmp/whatsapp-backup ]
  kill -TERM "$parent_pid"
  interrupted_status=0
  wait "$parent_pid" || interrupted_status=$?
  [ "$SCENARIO" = loop_interrupted ] || [ "$interrupted_status" -eq 143 ]
  ! kill -0 "$restic_pid" 2>/dev/null
  flock -n /tmp/whatsapp-backup.flock true
  [ ! -d /tmp/whatsapp-backup ]
  [ ! -f "$CASE_DIR/heartbeat" ]
  [ "$(cat /app/data/storages/.whatsapp-backup-last-success)" = 0 ]
  echo "PASS $SCENARIO (child stopped, lock released, marker unchanged)"
}

interruption_case interrupted /usr/local/bin/backup.sh
interruption_case loop_interrupted /usr/local/bin/backup-loop.sh

loop_result_case() {
  export SCENARIO=$1 CASE_DIR="$test_root/loop-$1"
  mkdir -p "$CASE_DIR"
  printf '0\n' > /app/data/storages/.whatsapp-backup-last-success
  /usr/local/bin/backup-loop.sh > "$CASE_DIR/output" 2>&1 &
  loop_pid=$!
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$SCENARIO" = success ]; then
      [ "$(cat /app/data/storages/.whatsapp-backup-last-success)" = 0 ] || break
    else
      ! grep -q 'retrying in one hour' "$CASE_DIR/output" || break
    fi
    /bin/sleep 0.1
  done
  if [ "$SCENARIO" = success ]; then
    [ -f "$CASE_DIR/heartbeat" ]
    [ "$(cat /app/data/storages/.whatsapp-backup-last-success)" -gt 0 ]
  else
    [ ! -f "$CASE_DIR/heartbeat" ]
    [ "$(cat /app/data/storages/.whatsapp-backup-last-success)" = 0 ]
    grep -q 'retrying in one hour' "$CASE_DIR/output"
  fi
  kill -TERM "$loop_pid"
  wait "$loop_pid"
  echo "PASS loop-$SCENARIO (success marker follows outcome)"
}

loop_result_case success
loop_result_case missing
