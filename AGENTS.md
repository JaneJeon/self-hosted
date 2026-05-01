# Agent Operations Guide

Operational knowledge for AI agents working on this repo. For project docs, see [README.md](README.md). For service-specific details, read the `README.md` in each service's directory under `services/`.

## Golden rules

1. **GitOps only** — all deploys via `git push`. Never use `railway redeploy`.
2. **Verify assumptions** — check docs, check logs, check live state. Don't guess.
3. **Never use `--no-verify`** when committing.
4. **Don't expose secrets** — use `direnv` (`.envrc`) for local env vars, Railway CLI for remote. Never hardcode credentials or print them in plaintext.
5. **Test before you push** — for any service with a Dockerfile, build and run it locally before pushing. Use Docker to replicate the Railway runtime exactly. Validate early, validate often, and question every assumption about what will happen in production.
6. **One logical change per commit** — no mega-commits. Each commit should be one coherent unit: a rename, a dependency addition, a config change. Makes history readable and reverts surgical.

## Railway CLI patterns

### Read state

```bash
railway service status --all --json | jq '.[] | {name, status}'
railway logs --service <name> --lines 100
railway variable list --service <name> --json | jq 'keys'  # keys only, no values
railway ssh --service <name> -- "<command>"
```

### Mutate state

```bash
railway variable set "KEY=value" --service <name>
railway link -e production -s <name> && railway volume add --mount-path <path>
```

### Things the CLI cannot do

- Connect a service to a GitHub repo source (must use Railway dashboard)
- View build logs (dashboard only)
- Trigger a cron job manually (dashboard only)

### Railway link scope

**Always `cd services/<name>` and run `railway service link <service-name>` before doing any Railway CLI work on a service.** The repo root has no linked service — each service manages its own Railway context inside its own directory. This is ergonomic for you AND makes it clear to the user which service you're operating on.

To add a volume to a service:

```bash
cd services/<name>
railway service link <service-name>
railway volume add --mount-path <path>
```

### Variable changes trigger immediate redeployment

**Setting, renaming, or deleting a Railway variable triggers an immediate rebuild and deploy.** Make sure code changes are committed and pushed (or the service is otherwise ready) BEFORE touching variables. Never change variables as a standalone step mid-implementation.

### Secrets management (swarp + 1Password)

Secrets use 1Password references in `.env.template` files. `swarp secrets refresh` resolves them into a local `.env`. Each service directory has an `.envrc` that auto-loads `.env` via direnv.

To inject secrets into Railway without exposing values:

```bash
cd services/<name>
swarp secrets refresh      # populates .env from 1Password
set -a && source .env && set +a
railway variable set "KEY=$KEY" ... --service <service-name>
```

### Multi-workspace gotcha

If `railway link` fails with `--workspace required in non-interactive mode`, pass the workspace ID explicitly. Get it from `railway whoami --json`.

## Debugging workflow

1. **Check status**: `railway service status --all --json`
2. **Check logs**: `railway logs --service <name> --lines 100`
   - Empty logs on a cron service is normal between runs
3. **Check env vars**: `railway variable list --service <name> --json | jq 'keys'`
4. **SSH in**: `railway ssh --service <name> -- "<command>"`
5. **Check B2 backups**: use `direnv exec . rclone` or `restic snapshots` with env vars from `.envrc`

## MySQL 8.4 compatibility

This is the #1 source of bugs in this repo. Know these rules:

### Alpine's mysql-client is MariaDB

Alpine's `apk add mysql-client` installs MariaDB tools. MariaDB cannot authenticate against MySQL 8.4's `caching_sha2_password`. There is no workaround within Alpine — you must use the `mysql:8.4` Docker image for any container that needs to connect to MySQL.

### Correct flags for internal (no-TLS) connections

```
--ssl-mode=DISABLED --get-server-public-key
```

Both are required:

- `--ssl-mode=DISABLED` — MySQL flag (NOT `--skip-ssl`, that's MariaDB)
- `--get-server-public-key` — enables RSA key exchange for `caching_sha2_password` auth over plaintext

### mysql:8.4 image is Oracle Linux

Uses `microdnf` as package manager, not `apt-get` or `apk`.

## Docker patterns in this repo

### Build-time envsubst (mysql, hoyolab-auto)

When secrets need to be baked into config files at build time:

1. Alpine stage: `apk add gettext`, runs `envsubst` on `.envsubst` templates
2. Final stage: `COPY --from=` the rendered files
3. Railway passes service variables as Docker `ARG`s during build

### Runtime ENV (ghost, uptime-kuma, mysql-backup)

Railway also injects variables as runtime `ENV` into running containers. No `ARG` declarations needed in the Dockerfile for these.

### Volume permissions (hoyolab-auto pattern)

Railway volumes mount as root. If the app runs as non-root:

```dockerfile
USER root
RUN apk add --no-cache su-exec
CMD ["sh", "-c", "chown user:user /app/data && exec su-exec user <start-command>"]
```

### Static binary copy (mysql-backup pattern)

When you need a tool from one image in a different base:

```dockerfile
FROM restic/restic:0.18.1 AS tool-source
FROM mysql:8.4
COPY --from=tool-source /usr/bin/restic /usr/local/bin/restic
```

Works when the binary is statically linked (Go binaries with `CGO_ENABLED=0`). Does NOT work for dynamically linked binaries across different libcs (e.g., glibc binary → Alpine musl).

## Restic + B2

### Repository path format

`b2:bucket-name:prefix` — uses COLON separator, not slash. Slash in the bucket name position causes `bucket name contains invalid characters`.

### Key env vars

| Variable            | Purpose                |
| ------------------- | ---------------------- |
| `RESTIC_REPOSITORY` | `b2:<bucket>:<prefix>` |
| `RESTIC_PASSWORD`   | Repo encryption key    |
| `B2_ACCOUNT_ID`     | Backblaze B2 key ID    |
| `B2_ACCOUNT_KEY`    | Backblaze B2 app key   |

### Useful commands

```bash
restic snapshots                          # list snapshots
restic dump <id> /all-databases.sql       # extract a snapshot
restic forget --keep-daily 7 --prune      # apply retention
restic unlock                             # break stale locks
```

## Uptime Kuma v2

- `UPTIME_KUMA_DB_TYPE` must be `"mariadb"` even when using MySQL 8.4 — it's the driver name, not the DB engine
- The `2-slim` image has no embedded database; it requires external MySQL
- Push monitors (`/api/push/<token>?status=up&msg=OK&ping=`) are used for cron health monitoring — the cron pings ONLY on success, so a missed ping triggers an alert

## Shell patterns

### Reading files with spaces in their paths

The `Read` tool fails on paths containing spaces. Copy to a safe path first:

```bash
find "/path/with spaces/to/dir" -name "filename*" -exec cp {} /tmp/safe_name \;
# then read /tmp/safe_name
```

### curl

Always specify the HTTP method explicitly and never use `-s` (silent mode):

```bash
curl -X GET "https://..."
curl -X POST "https://..." -H "Content-Type: application/json" -d '{...}'
```

`-s` suppresses output, which breaks prefix-based auto-approval in Claude Code. Pass this rule to any subagent that makes HTTP requests.

### git

**Always run git commands from the repo root** (`/Users/janejeon/Projects/janejeon/self-hosted`). Running git from a service subdirectory causes commands to hang indefinitely.

```bash
# correct — run from repo root, action first
git status
git add services/mysql/my.cnf
git commit -m "..."

# wrong — hangs
cd services/mysql && git status

# wrong — path before action; hard to read in approval prompts
git -C /path/to/repo status
```

### Railway deploy wait loop

`status` is a read-only variable in zsh. Use a different name:

```bash
for i in $(seq 1 20); do
  sleep 10
  deploy_status=$(railway service status --json 2>/dev/null | jq -r '.status')
  echo "$(date +%H:%M:%S) $deploy_status"
  [ "$deploy_status" = "SUCCESS" ] && break
done
```

## Common mistakes to avoid

- Using `--skip-ssl` with real MySQL client (MariaDB-only flag)
- Using `apt-get` on `mysql:8.4` (it's Oracle Linux, use `microdnf`)
- Using `b2:bucket/path` for restic (use `b2:bucket:path`)
- Forgetting `--get-server-public-key` when `--ssl-mode=DISABLED`
- Assuming cron service logs exist between runs (they don't)
- Using `railway redeploy` instead of `git push`
- Reading Railway config files that contain auth tokens without permission
