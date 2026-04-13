[![Node CI](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml)
[![Secrets Scan](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml)

Self-hosted infrastructure on [Railway](https://railway.com), deployed via GitOps.

## Architecture

All services run on Railway in a single project. Each service has its own directory under `services/` with a `Dockerfile` and `railway.json` (config-as-code).

### Services

| Service                    | Image Base                         | Purpose                               | Schedule        |
| -------------------------- | ---------------------------------- | ------------------------------------- | --------------- |
| **mysql**                  | `mysql:8.4`                        | Shared MySQL database                 | Persistent      |
| **ghost**                  | `ghost`                            | Blog (janejeon.blog)                  | Persistent      |
| **uptime-kuma**            | `louislam/uptime-kuma:2-slim`      | Monitoring & status page              | Persistent      |
| **hoyolab-auto**           | `ghcr.io/torikushiii/hoyolab-auto` | HoYoLab daily check-in                | Persistent      |
| **mysql-backup**           | `mysql:8.4` + restic               | Incremental MySQL backups to B2       | Cron (3 AM UTC) |
| **Tailscale**              | `tailscale`                        | VPN subnet router                     | Persistent      |
| **grafana-image-renderer** | `grafana/grafana-image-renderer`   | Server-side panel/dashboard rendering | Persistent      |

### How services connect

```
ghost ──────────┐
uptime-kuma ────┤──▶ mysql (mysql.railway.internal:3306)
mysql-backup ───┘
                          │
mysql-backup ─────────────┼──▶ B2 (restic repo)
                          │
mysql-backup ─────────────┼──▶ uptime-kuma (push heartbeat on success)
```

Inter-service communication is over Railway's private network (`*.railway.internal`).

## Deployment

All deploys go through `git push`. Each service's `railway.json` has `watchPatterns` that determine which file changes trigger a rebuild.

### Environment variables

Railway injects service variables at both build time (as Docker `ARG`s) and runtime (as `ENV`):

- **Build-time ARGs**: Used by `mysql` and `hoyolab-auto` for `envsubst` template rendering during `docker build`
- **Runtime ENV**: Used by `ghost`, `uptime-kuma`, `mysql-backup` at container start

### Volumes

Created via Railway CLI. Volumes mount as root — services running as non-root must handle ownership in their entrypoint.

| Service      | Mount path       |
| ------------ | ---------------- |
| mysql        | `/var/lib/mysql` |
| uptime-kuma  | `/app/data`      |
| hoyolab-auto | `/app/data`      |

## Backup & Restore

### Backup

The `mysql-backup` cron job streams `mysqldump --all-databases` directly into restic (no intermediate file). Restic deduplicates at the block level, so daily full dumps only store the deltas. The repository lives in Backblaze B2.

Retention: keep-last 10, daily 7, weekly 5, monthly 12.

On success, it pings Uptime Kuma's push monitor. If the backup fails silently, the missed ping triggers an alert.

### Restore

```bash
# Set RESTIC_REPOSITORY, RESTIC_PASSWORD, B2_ACCOUNT_ID, B2_ACCOUNT_KEY
restic snapshots                                              # list available snapshots
restic dump <snapshot-id> /all-databases.sql | mysql -h <host> -u root -p  # restore
```

## MySQL

MySQL 8.4 uses `caching_sha2_password` authentication by default. This is incompatible with Alpine's MariaDB-based `mysql-client` package — any service that needs to connect to MySQL must use the official `mysql:8.4` image for its client tools.

`my.cnf` includes `innodb_default_row_format = DYNAMIC` to prevent InnoDB row-size limit errors with Uptime Kuma v2's schema.

Init scripts use `envsubst` at build time (multi-stage Dockerfile) and only run on a fresh empty data directory.

## Local Development

### Prerequisites

- [nvm](https://nvm.sh) — `nvm use && npm install` (installs git hooks)
- [direnv](https://direnv.net/) — loads `.envrc` secrets automatically
- [Gitleaks](https://github.com/gitleaks/gitleaks) — `brew install gitleaks` (pre-commit secrets scan)
