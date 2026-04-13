## Backup

Streams `mysqldump --all-databases` directly into restic (no intermediate file). Restic deduplicates at the block level, so daily full dumps only store the deltas. The repository lives in Backblaze B2.

Retention: keep-last 10, daily 7, weekly 5, monthly 12.

On success, it pings Uptime Kuma's push monitor. If the backup fails silently, the missed ping triggers an alert.

## Restore

```bash
# Set RESTIC_REPOSITORY, RESTIC_PASSWORD, B2_ACCOUNT_ID, B2_ACCOUNT_KEY
restic snapshots                                              # list available snapshots
restic dump <snapshot-id> /all-databases.sql | mysql -h <host> -u root -p  # restore
```
