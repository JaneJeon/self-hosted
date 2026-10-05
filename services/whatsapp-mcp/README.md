# WhatsApp MCP

This service builds the pinned upstream Go source with one result adapter. It
serves the upstream SSE MCP endpoint at `/sse` on port 8080, reachable only over
Railway private networking. Agentgateway exposes the public Streamable HTTP
endpoint. The local `mcp.js` desktop wrapper is not deployed.

`mcp-result-compat.go` ports the local wrapper's result behavior: preserve
`structuredContent` and append its JSON as a text block. Claude and other
clients that consume only text now receive actual contacts, chats, and message
rows, instead of only "Retrieved N messages". The Docker builder applies this
helper to the pinned upstream's structured-result call sites and runs its test.
Tool names, schemas, device selection, and database state are unchanged.

Mount one Railway volume at `/app/data`. The image links upstream `storages`
and `statics` to this volume. Both SQLite databases, their WAL state, message
history, and media live there. Run exactly one replica. Before initial startup,
stop the Mac instance and transfer a consistent snapshot of the local state.
The container may be deployed before cutover: it waits without starting Go
until `/app/data/.migration-ready` and both SQLite databases exist. Upload the
marker only after the complete snapshot is on the volume.

The entrypoint passes an empty environment except for fixed non-secret values
to the Go process. Its `--host` defaults to `RAILWAY_PRIVATE_DOMAIN` so the SSE
message endpoint names an address that agentgateway can reach. For local Docker
testing, set `WHATSAPP_MCP_HOST` to the container hostname on a test network.
Upstream also binds its listener to this hostname. During Railway rollouts the
service DNS can still point to the previous container, so the entrypoint maps
the advertised private name to its own container address in `/etc/hosts`.
Other containers still use Railway DNS; upstream source remains unchanged.

The entrypoint requires the B2 backup variables and waits for both migrated
databases and the marker. A background loop starts a backup when none has
succeeded in the past 24 hours, then retries failures hourly. It copies each
database with SQLite online backup, stages other state and media, and backs the
snapshot up to an encrypted restic repository. Retention is last 10, daily 7,
weekly 5, monthly 12. Only success pings the Kuma push monitor.
SQLite copies wait up to 30 seconds for locks and retry up to five times before
the job fails, allowing concurrent startup and normal database writes to finish.
Backups use the stable hostname `whatsapp-mcp`; retention groups by backup path
so a new container does not create a separate retention history.
The backup job holds a kernel file lock. Children can inherit that descriptor,
so termination stops the active command before removing staging data. The loop
forwards termination to the active job. No lock directory needs manual deletion.

Each job has a one-hour deadline. Restic operations get three fresh attempts,
each limited to five minutes with a 30-second kill grace and ten seconds between
attempts. Each SQLite copy has a 60-second deadline while preserving the existing
30-second lock wait and five attempts. Heartbeats have a ten-second connection
timeout and a 30-second total deadline. The image uses GNU timeout for process
group handling.

Provision repositories explicitly with `restic init`. A failed repository read
leaves its diagnostic visible and fails the job without attempting initialization.

Keep the Kuma monitor paused while the service is waiting for initial migration.
After state transfer, a successful snapshot restore check, and startup of the
daily loop, resume the monitor and verify a real successful backup heartbeat.
Do not send a synthetic success to suppress an alert. A paused Kuma monitor
rejects its push URL with 404 (`Monitor not found or not active`), even when the
preceding B2 snapshot and retention succeeded.

For cutover, stop the Mac Go process first. Run
`python3 export-state.py <local-upstream>/src <new-empty-export-directory>` to
copy other state and media and make validated SQLite copies. Create a tar archive
containing the exported `storages` and `statics` directories. Upload that one
file with `railway volume files --volume whatsapp-mcp-volume upload
<archive> /whatsapp-state.tar`; the CLI's `/` is the container's `/app/data`.
Compare the archive's SHA-256 locally and through `railway ssh`, then extract
it inside the waiting container to `/app/data`. Check both uploaded databases
with `PRAGMA quick_check`. Upload an empty `/.migration-ready` file last to
start Go and the backup loop. Keep the local source and export for rollback.

Required backup variables: `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`,
`B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`, and `HEARTBEAT_URL`. Store their source
values in 1Password and inject them into Railway without argv or log exposure.
Use a repository distinct from the MySQL backup prefix. Restore into a
temporary directory first, verify both SQLite databases with `PRAGMA
quick_check`, then copy their contents into the stopped service volume.
See [RECOVERY.md](RECOVERY.md) for the required stop, restore, and rollback order.
The B2 key is the existing scoped Railway key; the `Railway WhatsApp MCP Backup`
item holds a separate repository path and restic password. `.env.template`
resolves the backup credentials and the dedicated Kuma monitor URL through
`swarp secrets refresh`.

## Backup verification

```bash
docker build -t whatsapp-backup-test services/whatsapp-mcp
docker run --rm --entrypoint sh \
  -v "$PWD/services/whatsapp-mcp/test-backup.sh:/test-backup.sh:ro" \
  whatsapp-backup-test /test-backup.sh
python3 services/whatsapp-mcp/test-round-trip.py
```

The checks use disposable data. They cover deadlines, retries, concurrent jobs,
interrupted children, lock release, success markers, and a real SQLite WAL
backup/restore with state and media hashes. Native AMD64 GitHub Actions runs
the same checks for this service's changes.

For an incident, read Craft's `Library/Playbooks/A backup missed its heartbeat`
and `Library/Playbooks/I need to verify backup recovery before closing an incident`.
The service's current monitoring and data-protection state lives in
`Library/Systems/WhatsApp MCP on Railway — migration and backup monitoring`.
