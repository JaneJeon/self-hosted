## Volume

Mounts at `/app/data`.

## Database credentials

Keep `UPTIME_KUMA_DB_PASSWORD` as a Railway reference to
`MySQL.UPTIME_KUMA_MYSQL_PASSWORD`. Its source is the `Railway MySQL` 1Password
item. The MySQL README owns the dual-password cutover procedure for the existing
database account. After changing credentials, deploy this consumer through git
push and verify real monitor processing before discarding the old password.

The MySQL monitor also saves a connection string in Kuma's database. Update its
password through Kuma when rotating `uptime_kuma_user`; Railway variable
references do not update this saved setting. Verify a fresh successful database
check before discarding the retained password. Keep the connection string out
of logs and command arguments.
