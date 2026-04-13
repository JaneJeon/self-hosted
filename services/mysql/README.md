## MySQL 8.4

Uses `caching_sha2_password` authentication by default. This is incompatible with Alpine's MariaDB-based `mysql-client` package — any service that needs to connect to MySQL must use the official `mysql:8.4` image for its client tools.

`my.cnf` includes `innodb_default_row_format = DYNAMIC` to prevent InnoDB row-size limit errors with Uptime Kuma v2's schema.

Init scripts use `envsubst` at build time (multi-stage Dockerfile) and only run on a fresh empty data directory.

## Volume

Mounts at `/var/lib/mysql`.
