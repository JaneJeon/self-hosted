#!/bin/bash
set -euo pipefail

test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"

cat > "$test_root/bin/restic" <<'STUB'
#!/bin/bash
set -eu
operation=$1
printf '%s\n' "$operation" >> "$CASE_DIR/calls"
count=0
[[ ! -f "$CASE_DIR/$operation" ]] || read -r count < "$CASE_DIR/$operation"
count=$((count + 1))
printf '%s\n' "$count" > "$CASE_DIR/$operation"
case "$SCENARIO:$operation" in
  transient:cat)
    if [[ "$count" -eq 1 ]]; then
      echo 'fixture network error' >&2
      exit 1
    fi
    ;;
  stalled_once:cat)
    if [[ "$count" -eq 1 ]]; then
      /usr/bin/sleep 30
    fi
    ;;
  stalled:cat) /usr/bin/sleep 30 ;;
  missing:cat) echo 'fixture repository missing' >&2; exit 10 ;;
  backup_failed:backup) exit 1 ;;
  retention_failed:forget) exit 1 ;;
esac
STUB

cat > "$test_root/bin/timeout" <<'STUB'
#!/bin/bash
set -eu
# Exercise a real process deadline without making the test wait five minutes.
[[ "$1" == --kill-after=30s && "$2" == 5m ]]
shift 2
exec /usr/bin/timeout --kill-after=1s 1s "$@"
STUB

cat > "$test_root/bin/sleep" <<'STUB'
#!/bin/bash
[[ "$1" == 10 ]]
STUB

cat > "$test_root/bin/curl" <<'STUB'
#!/bin/bash
set -eu
cat > "$CASE_DIR/heartbeat-config"
printf '%s\n' "$*" > "$CASE_DIR/curl-arguments"
touch "$CASE_DIR/heartbeat"
[[ "$SCENARIO" != heartbeat_failed ]]
STUB
chmod +x "$test_root/bin/"*

export PATH="$test_root/bin:$PATH"
export MYSQL_HOST=fixture MYSQL_ROOT_PASSWORD=fixture
export RESTIC_REPOSITORY=fixture RESTIC_PASSWORD=fixture
export B2_ACCOUNT_ID=fixture B2_ACCOUNT_KEY=fixture
export HEARTBEAT_URL='http://fixture/api/push/fixture-token?status=up'

run_case() {
  export SCENARIO=$1 CASE_DIR="$test_root/$1"
  mkdir -p "$CASE_DIR"
  local exit_code=0 started=$SECONDS
  /usr/local/bin/backup > "$CASE_DIR/output" 2>&1 || exit_code=$?

  case "$SCENARIO" in
    success|transient|stalled_once)
      [[ "$exit_code" -eq 0 && -f "$CASE_DIR/heartbeat" ]]
      [[ -f "$CASE_DIR/backup" && -f "$CASE_DIR/forget" ]]
      ;;
    heartbeat_failed)
      [[ "$exit_code" -ne 0 && -f "$CASE_DIR/heartbeat" ]]
      ;;
    *)
      [[ "$exit_code" -ne 0 && ! -f "$CASE_DIR/heartbeat" ]]
      ;;
  esac

  case "$SCENARIO" in
    transient|stalled_once) [[ "$(cat "$CASE_DIR/cat")" == 2 ]] ;;
    stalled|missing)
      [[ "$(cat "$CASE_DIR/cat")" == 3 && ! -f "$CASE_DIR/backup" ]]
      ;;
    backup_failed) [[ "$(cat "$CASE_DIR/backup")" == 3 && ! -f "$CASE_DIR/forget" ]] ;;
    retention_failed) [[ "$(cat "$CASE_DIR/forget")" == 3 ]] ;;
  esac

  [[ "$((SECONDS - started))" -lt 10 ]]
  ! grep -qx init "$CASE_DIR/calls"
  if [[ -f "$CASE_DIR/curl-arguments" ]]; then
    grep -q -- '--connect-timeout 10 --max-time 30' "$CASE_DIR/curl-arguments"
    ! grep -q fixture-token "$CASE_DIR/curl-arguments"
  fi
  if [[ "$SCENARIO" == transient ]]; then
    grep -q 'fixture network error' "$CASE_DIR/output"
  fi
  echo "PASS $SCENARIO (exit $exit_code)"
}

for scenario in success transient stalled_once stalled missing backup_failed retention_failed heartbeat_failed; do
  run_case "$scenario"
done
