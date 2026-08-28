# Agent Operations Guide

Operational knowledge for AI agents working on this repo. For project docs, see [README.md](README.md). For service-specific details, read the `README.md` in each service's directory under `services/`.

## Golden rules

1. **GitOps only** — all deploys via `git push`. Never use `railway redeploy`.
2. **Verify assumptions** — check docs, check logs, check live state. Don't guess.
3. **Never use `--no-verify`** when committing.
4. **Don't expose secrets** — use `direnv` (`.envrc`) for local env vars, Railway CLI for remote. Never hardcode credentials or print them in plaintext.
5. **Test before you push** — for any service with a Dockerfile, build and run it locally before pushing. Use Docker to replicate the Railway runtime exactly. Validate early, validate often, and question every assumption about what will happen in production.
6. **One logical change per commit** — no mega-commits. Each commit should be one coherent unit: a rename, a dependency addition, a config change. Makes history readable and reverts surgical.

## Working rules for agents (learned the hard way)

Every rule below is here because it was violated during the 2026-08-28 hoyolab
cookie / xfinity outage investigation and cost real time or produced wrong work.

### Never commit something you know or suspect is broken

`services/mysql-backup/.env.template` was committed while _already knowing_ it
referenced 1Password items that did not exist, with the problem noted in the PR
description instead. Flagging a defect is not a substitute for not shipping it.
If you have verified something is broken, exclude it and say why.

### Do not write a claim into code, comments, or docs that you have not verified

A commit landed asserting that a 404 from the Uptime Kuma push URL "means the
push monitor no longer exists". That was a guess. The real cause was Kuma
restarting the monitor after a `stat_hourly` duplicate-key error, so the 404 was
transient — which inverted the correct retry behaviour. A plausible mechanism
written in an authoritative voice is worse than an admitted unknown, because the
next reader treats it as established.

Say "I could not verify X" instead. It is always an acceptable answer.

### Fixing the handling is not the same as finding the cause

The heartbeat crash was "fixed" (stop crashing on a failed ping) before anyone
asked _why the ping failed_. Both are needed. Ask explicitly: do I know the
cause, or only the symptom?

### The dashboard is not evidence of what is running

`railway variable list` returning the new value does not mean the container has
it. Verify from the service's own behaviour — its logs — not from control-plane
state. See [A variable change alone may not reach the container](#a-variable-change-alone-may-not-reach-the-container).

### Reality first: read the failing thing before theorizing about it

When a system misbehaves, the FIRST action is to read its actual state at the
finest grain available — the exact bytes of its config, its own logs, the
surface closest to the failing code. Not the dashboard, not a view, not your
memory of what was set. The 2026-08-28 cookie incident burned hours on four
successive theories (stale env, build cache, staged changes, needs-rebuild)
while `railway environment config -e production --json` would have shown the
answer — a leading space in the value — in one command, at any point.

A theory is only worth holding after naming the observation that would falsify
it; if that observation costs one command, run the command instead. Your second
theory about the same symptom is the signal that you are avoiding a read. When
a deduction and a log disagree, the log wins. If retention has aged out the
evidence, say "I could not verify" rather than reconstructing a plausible
story.

### Match the conventions of the file you are editing

A test was appended using a `silentLogger` helper that did not exist, because
the file's existing `fakeLogger()`/`opts()` helpers were never read. Read the
surrounding code first, even for a small addition.

### The shell resets its working directory between commands

Each Bash invocation starts in the repo root regardless of a previous `cd`. Use
absolute paths, or `cd` as the first clause of the same command. Several files
were wrongly concluded to be "missing" or "permission-blocked" when the command
was simply running from the wrong directory.

### Use direnv, not ad-hoc secret reads

Once `swarp secrets refresh` has run, use `direnv exec . <command>`. Do not
shell out to `op read` per command — it is slower, prompts for auth, and risks
putting secret values into command lines.

### Write the lesson down before the session ends

Corrections given in conversation are lost when the session is. If a correction
changes how work should be done here, it belongs in this file (or the relevant
service README) as part of the same change — not in a summary message.

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

### Token scopes matter

There are two kinds of Railway token and they are not interchangeable:

| Token                   | Env var             | Works for                                      | Fails on                      |
| ----------------------- | ------------------- | ---------------------------------------------- | ----------------------------- |
| Project token           | `RAILWAY_TOKEN`     | `logs`, `variable list/set`, `deployment list` | `link`, `service link`, `ssh` |
| Account/workspace token | `RAILWAY_API_TOKEN` | all of the above, plus `whoami`                | —                             |

A project token is scoped to one project+environment, so account-level
operations return a bare `Unauthorized`. If `railway link` or `railway ssh`
fails that way, the token type is the cause — not the token's validity. Pass
`--service <name>` explicitly instead of linking.

`railway ssh` additionally needs a registered SSH key (`railway ssh keys add`).

Note that an invalid `RAILWAY_TOKEN` in the environment **overrides** a working
interactive login, so a stale `.env` can break a CLI that would otherwise work.
Use `env -u RAILWAY_TOKEN railway ...` to test that.

### Things the CLI cannot do

- Connect a service to a GitHub repo source (must use Railway dashboard)
- View build logs (dashboard only)
- Trigger a cron job manually (dashboard only)

### Railway link scope

**Prefer `cd services/<name>` and `railway service link <service-name>` before doing Railway CLI work on a service.** The repo root has no linked service — each service manages its own Railway context inside its own directory. This is ergonomic for you AND makes it clear to the user which service you're operating on.

This requires an account token (see [Token scopes matter](#token-scopes-matter)). With a project token, `link` fails with a bare `Unauthorized` — pass `--service <name>` to each command instead.

To add a volume to a service:

```bash
cd services/<name>
railway service link <service-name>
railway volume add --mount-path <path>
```

### Variable changes trigger immediate redeployment

**Setting, renaming, or deleting a Railway variable triggers an immediate rebuild and deploy.** Make sure code changes are committed and pushed (or the service is otherwise ready) BEFORE touching variables. Never change variables as a standalone step mid-implementation.

### Debugging "the variable is right but the service acts wrong"

`railway variable list` and `railway environment config -e <env> --json` are
different views: `environment config` shows the **committed configuration that
deployments actually use**, per service, including the exact bytes of every
variable. When a service behaves as if it has a different value than the
dashboard shows, diff the two before inventing theories about caching.

Also: Railway dedupes on value — re-setting a variable to its current value is
a no-op (the triggered deploy shows as SKIPPED) and will not restart anything.

The 2026-08-28 hoyolab incident that motivated this section: the "wrong" value
was never stale — the stored cookie began with a **leading space**, so the
app's non-trimming `split("; ")` parser read the first cookie's key as
`" account_mid_v2"` and disabled redemption. The bytes in `environment config`
settled in minutes what hours of redeploy theories could not. Check the actual
bytes (leading/trailing whitespace especially) before anything else.

### Secrets management (swarp + 1Password)

Secrets use 1Password references in `.env.template` files. `swarp secrets refresh` resolves them into a local `.env`. The root `.env.template` holds only `RAILWAY_API_TOKEN` (Railway CLI). Service-specific secrets (e.g. B2/restic for `mysql-backup`) live in that service's `.env.template`.

Each service directory has an `.envrc` that calls `source_up` to inherit the root env (Railway token). Services with their own secrets add `dotenv .env` after `source_up`.

`swarp secrets refresh` is all-or-nothing: if any `.env.template` references a
1Password item that does not exist, the whole run aborts and **no** service's
`.env` is written — including the root `RAILWAY_API_TOKEN`. A missing item in one
service therefore breaks the Railway CLI everywhere. Verify with
`op item list --vault "Self Hosting" --format json | jq -r '.[].title'`.

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

0. **Read the failing component's actual state first** — exact bytes, own logs
   (see "Reality first" above). For variables: `railway environment config -e production --json`,
   and check leading/trailing whitespace before anything else.
1. **Check status**: `railway service status --all --json`
2. **Check logs**: `railway logs --service <name> --lines 100`
   - Empty logs on a cron service is normal between runs
3. **Check env vars**: `railway variable list --service <name> --json | jq 'keys'`
4. **SSH in**: `railway ssh --service <name> -- "<command>"`
5. **Check B2 backups**: `cd services/mysql-backup && swarp secrets refresh`, then `direnv exec . restic snapshots`

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

### Build-time envsubst (mysql)

When secrets need to be baked into config files at build time:

1. Alpine stage: `apk add gettext`, runs `envsubst` on `.envsubst` templates
2. Final stage: `COPY --from=` the rendered files
3. Railway passes service variables as Docker `ARG`s during build

### Runtime envsubst (hoyolab-auto)

`hoyolab-auto` renders its config at **container start**, not build time: the
`CMD` runs `envsubst` over `config.json5.template` into `/app/config.json5`
before exec'ing the app. Only the variables named in the `envsubst` shell-format
argument are substituted — adding a new one to the template requires adding it
there too, or it is silently left as a literal `$VAR`.

Because the render happens at start-up, the value comes from the container's
runtime environment — which is exactly why a stale env snapshot on a cached
redeploy produces a correct-looking variable and a wrong-looking app.

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
