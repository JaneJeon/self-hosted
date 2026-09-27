# WhatsApp MCP

This service builds the pinned upstream Go source without modifications. It
serves the upstream SSE MCP endpoint at `/sse` on port 8080, reachable only over
Railway private networking. Agentgateway exposes the public Streamable HTTP
endpoint. The local `mcp.js` desktop wrapper is not deployed.

Mount one Railway volume at `/app/data`. The image links upstream `storages`
and `statics` to this volume. Both SQLite databases, their WAL state, message
history, and media live there. Run exactly one replica. Before initial startup,
stop the Mac instance and transfer a consistent snapshot of the local state.

The entrypoint passes an empty environment except for fixed non-secret values
to the Go process. Its `--host` defaults to `RAILWAY_PRIVATE_DOMAIN` so the SSE
message endpoint names an address that agentgateway can reach. For local Docker
testing, set `WHATSAPP_MCP_HOST` to the container hostname on a test network.

The entrypoint refuses to start until both migrated databases and the B2
backup variables are present. A background loop starts a backup when none has
succeeded in the past 24 hours, then retries failures hourly. It copies each
database with SQLite online backup, stages other state and media, and backs the
snapshot up to an encrypted restic repository. Retention is last 10, daily 7,
weekly 5, monthly 12. Only success pings the Kuma push monitor.

Required backup variables: `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`,
`B2_ACCOUNT_ID`, `B2_ACCOUNT_KEY`, and `HEARTBEAT_URL`. Store their source
values in 1Password and inject them into Railway without argv or log exposure.
Use a repository distinct from the MySQL backup prefix. Restore into a
temporary directory first, verify both SQLite databases with `PRAGMA
quick_check`, then copy their contents into the stopped service volume.
The B2 key is the existing scoped Railway key; the `Railway WhatsApp MCP Backup`
item holds a separate repository path and restic password. `.env.template`
resolves these four values through `swarp secrets refresh`. Add the Kuma
heartbeat URL to this template after its new push monitor exists.
