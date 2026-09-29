# WhatsApp MCP

This service builds the pinned upstream Go source without modifications. It
serves the upstream SSE MCP endpoint at `/sse` on port 8080, reachable only over
Railway private networking. Agentgateway exposes the public Streamable HTTP
endpoint. The local `mcp.js` desktop wrapper is not deployed.

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

The entrypoint requires the B2 backup variables and waits for both migrated
databases and the marker. A background loop starts a backup when none has
succeeded in the past 24 hours, then retries failures hourly. It copies each
database with SQLite online backup, stages other state and media, and backs the
snapshot up to an encrypted restic repository. Retention is last 10, daily 7,
weekly 5, monthly 12. Only success pings the Kuma push monitor.
Backups use the stable hostname `whatsapp-mcp`; retention groups by backup path
so a new container does not create a separate retention history.

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
The B2 key is the existing scoped Railway key; the `Railway WhatsApp MCP Backup`
item holds a separate repository path and restic password. `.env.template`
resolves the backup credentials and the dedicated Kuma monitor URL through
`swarp secrets refresh`.
