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

## Replacing backup credentials

When replacing the Kuma push token, update the existing backup monitor and save
its URL in the existing 1Password `heartbeat url` field. Preserve Railway's
private HTTP references while changing only the token. Stage with
`--skip-deploys`, deploy through git push, and verify a real backup completion
and stored monitor receipt. A hand-written push does not prove the backup ran.

The B2 application key is shared with WhatsApp's backup. Update both consumers
from the existing 1Password item through stdin, with deployments suppressed
until the complete configuration is ready.

To replace a restic encryption key, initialize a new repository with a new
password. Changing the password on the existing repository keeps its encryption
key. Preserve the old repository location and password before updating the
active 1Password fields. Verify a real backup and a private restore from the
new repository before retiring any old data. Deploy through git push, then
check the producer's logs, stored snapshot, and the real Kuma heartbeat.

The incident record is the Craft [Railway env var breach response Index](https://docs.craft.do/editor/d/53687cd7-874b-cff7-84ed-3a082a04cb77/5f8e4e12-cd52-bc9b-0454-3368f2cb8484).

## Verification

Build the runtime image and run the failure-path checks inside it:

```bash
docker build -t mysql-backup-test services/mysql-backup
docker run --rm --entrypoint bash \
  -v "$PWD/services/mysql-backup/test-backup.sh:/test-backup.sh:ro" \
  mysql-backup-test /test-backup.sh
python3 services/mysql-backup/test-round-trip.py
```

The round-trip check creates a disposable MySQL server and local restic
repository. It restores fixture rows and verifies that a partial dump creates
neither a new snapshot nor a success heartbeat. GitHub Actions runs both checks
on native AMD64 Linux for matching pull requests and pushes.

## Restore

```bash
cd services/mysql-backup
swarp secrets refresh
direnv allow
restic snapshots                                              # list available snapshots
restic dump <snapshot-id> /all-databases.sql | mysql -h <host> -u root -p  # restore
```
