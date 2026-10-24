## MySQL 8.4

Uses `caching_sha2_password` authentication by default. This is incompatible with Alpine's MariaDB-based `mysql-client` package — any service that needs to connect to MySQL must use the official `mysql:8.4` image for its client tools.

`my.cnf` includes `innodb_default_row_format = DYNAMIC` to prevent InnoDB row-size limit errors with Uptime Kuma v2's schema.

Init scripts use `envsubst` at build time (multi-stage Dockerfile) and only run on a fresh empty data directory.

## Changing passwords on an existing volume

The `Railway MySQL` 1Password item owns root, Ghost, and Kuma passwords.
`Railway Keycloak` owns its database password. Resolve `.env.template` through
swarp and direnv. Keep dependent Railway variables as references to MySQL's
password variables.

Rebuilding initialization scripts does not change existing database accounts.
Enumerate their exact user and host identities first. Use MySQL's dual-password
support for a coordinated cutover: set each replacement with
`ALTER USER ... IDENTIFIED BY ... RETAIN CURRENT PASSWORD`. Update MySQL's
Railway password variables from their 1Password sources through stdin with
`--skip-deploys`, then deploy MySQL and its consumers through git push.
Kuma's saved MySQL monitor connection string is also a consumer of
`uptime_kuma_user`; update it through Kuma and verify a fresh database check.
Confirm that each running consumer received the replacement and can reconnect
before running `ALTER USER ... DISCARD OLD PASSWORD`. Successful connections
alone are insufficient while the retained password also works. Check both root
host entries when present. Send SQL and credentials through Railway SSH's
encrypted channel using stdin, never command arguments.

Verify that the replacement authenticates as the intended `CURRENT_USER()` and
that the retired password receives an explicit authentication rejection.
A transport failure does not establish revocation. Changing the primary
password alone does not remove an existing secondary password.

The incident record is the Craft [Railway env var breach response Index](https://docs.craft.do/editor/d/53687cd7-874b-cff7-84ed-3a082a04cb77/5f8e4e12-cd52-bc9b-0454-3368f2cb8484).

## Memory

`performance_schema` is disabled. When enabled, it pre-allocates ~226 MB in fixed-size tables
(statement digests, error summaries, wait histories, etc.), pushing total RSS from ~200 MB to ~400 MB.
The InnoDB footprint itself is only ~74 MB (`ut0link_buf` 24 MB + buffer pool 20 MB + log buffer 8 MB +
sync structures ~7 MB + misc).

The ~3–4 MB/day RSS growth observed over weeks is **glibc malloc fragmentation**, not a data leak.
Evidence: `Com_insert ≈ Com_delete` (Uptime Kuma heartbeat churn keeps the dataset near steady-state),
so MySQL's tracked allocations stay flat while the OS RSS creeps up — freed memory is held by the
allocator rather than returned to the OS.

**Fix:** The Dockerfile installs jemalloc from Oracle EPEL and sets `LD_PRELOAD=/usr/lib64/libjemalloc.so.2`.
jemalloc's size-class allocator returns memory to the OS promptly, eliminating the RSS drift. This is the
same approach Percona Server uses internally.

## Volume

Mounts at `/var/lib/mysql`.

## Binary logging

Binary logging is disabled via `skip-log-bin`. There is no replication and no point-in-time recovery configured, so binlogs were accumulating ~3.4 MB/day on the volume with no consumer.

If replication or PITR is ever set up, remove `skip-log-bin` and add a retention policy (`binlog_expire_logs_seconds`).

## InnoDB redo log

`innodb_redo_log_capacity` is set to 64M. The MySQL 8.0.30+ default is 100M; we previously used 10M to save disk space, but that caused excessive checkpoint pressure — InnoDB was forced to flush dirty pages far too aggressively to keep the log from filling. 64M eliminates the churn while staying well under the default.
