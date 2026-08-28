[![Node CI](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/node.yml)
[![Secrets Scan](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml/badge.svg)](https://github.com/JaneJeon/self-hosted/actions/workflows/secrets.yml)

Self-hosted infrastructure on [Railway](https://railway.com), deployed via GitOps.

## Architecture

All services run on Railway in a single project. Each service has its own directory under `services/` with a `Dockerfile` and `railway.json` (config-as-code). See each service's directory for service-specific details.

### Services

| Service          | Image Base                         | Purpose                         | Schedule        |
| ---------------- | ---------------------------------- | ------------------------------- | --------------- |
| **mysql**        | `mysql:8.4`                        | Shared MySQL database           | Persistent      |
| **ghost**        | `ghost`                            | Blog (janejeon.blog)            | Persistent      |
| **uptime-kuma**  | `louislam/uptime-kuma:2-slim`      | Monitoring & status page        | Persistent      |
| **hoyolab-auto** | `ghcr.io/torikushiii/hoyolab-auto` | HoYoLab daily check-in          | Persistent      |
| **mysql-backup** | `mysql:8.4` + restic               | Incremental MySQL backups to B2 | Cron (3 AM UTC) |
| **Tailscale**    | `tailscale`                        | VPN subnet router               | Persistent      |

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

## Local Development

### Prerequisites

- [nvm](https://nvm.sh) — `nvm use && npm install` (installs git hooks)
- [direnv](https://direnv.net/) — loads `.envrc` secrets automatically; service directories inherit `RAILWAY_API_TOKEN` from the root `.envrc` via `source_up`
- [Gitleaks](https://github.com/gitleaks/gitleaks) — `brew install gitleaks` (pre-commit secrets scan)
