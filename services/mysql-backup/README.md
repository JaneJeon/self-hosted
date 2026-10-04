## Backup

Streams `mysqldump --all-databases` directly into restic (no intermediate file). Restic deduplicates at the block level, so daily full dumps only store the deltas. The repository lives in Backblaze B2.

Retention: keep-last 10, daily 7, weekly 5, monthly 12.

On success, it pings Uptime Kuma's push monitor. If the backup fails silently, the missed ping triggers an alert.

Each restic operation has three attempts. An attempt has a five-minute deadline,
with 30 seconds to stop before it is killed, and retries start a fresh process
after ten seconds. Repository errors stay visible in the logs. An exhausted
operation exits without sending a heartbeat, freeing the next scheduled run.
The heartbeat has a ten-second connection timeout and a 30-second total deadline.

The repository must already exist. Run `restic init` explicitly when provisioning
a new repository. The job never interprets a network or authentication error as
a request to initialize one.

## Verification

Build the runtime image and run the failure-path checks inside it:

```bash
docker build -t mysql-backup-test services/mysql-backup
docker run --rm --entrypoint bash \
  -v "$PWD/services/mysql-backup/test-backup.sh:/test-backup.sh:ro" \
  mysql-backup-test /test-backup.sh
```

## Restore

```bash
cd services/mysql-backup
swarp secrets refresh
direnv allow
restic snapshots                                              # list available snapshots
restic dump <snapshot-id> /all-databases.sql | mysql -h <host> -u root -p  # restore
```
