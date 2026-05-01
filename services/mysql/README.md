## MySQL 8.4

Uses `caching_sha2_password` authentication by default. This is incompatible with Alpine's MariaDB-based `mysql-client` package — any service that needs to connect to MySQL must use the official `mysql:8.4` image for its client tools.

`my.cnf` includes `innodb_default_row_format = DYNAMIC` to prevent InnoDB row-size limit errors with Uptime Kuma v2's schema.

Init scripts use `envsubst` at build time (multi-stage Dockerfile) and only run on a fresh empty data directory.

## Memory

`performance_schema` is disabled. When enabled, it pre-allocates ~226 MB in fixed-size tables
(statement digests, error summaries, wait histories, etc.), pushing total RSS from ~200 MB to ~400 MB.
The InnoDB footprint itself is only ~74 MB (`ut0link_buf` 24 MB + buffer pool 20 MB + log buffer 8 MB +
sync structures ~7 MB + misc).

The ~3–4 MB/day RSS growth observed over weeks is **glibc malloc fragmentation**, not a data leak.
Evidence: `Com_insert ≈ Com_delete` (Uptime Kuma heartbeat churn keeps the dataset near steady-state),
so MySQL's tracked allocations stay flat while the OS RSS creeps up — freed memory is held by the
allocator rather than returned to the OS. The only fixes are switching to jemalloc (requires a custom
image) or accepting periodic restarts.

## Volume

Mounts at `/var/lib/mysql`.

## Binary logging

Binary logging is disabled via `skip-log-bin`. There is no replication and no point-in-time recovery configured, so binlogs were accumulating ~3.4 MB/day on the volume with no consumer.

If replication or PITR is ever set up, remove `skip-log-bin` and add a retention policy (`binlog_expire_logs_seconds`).

## InnoDB redo log

`innodb_redo_log_capacity` is set to 64M. The MySQL 8.0.30+ default is 100M; we previously used 10M to save disk space, but that caused excessive checkpoint pressure — InnoDB was forced to flush dirty pages far too aggressively to keep the log from filling. 64M eliminates the churn while staying well under the default.
