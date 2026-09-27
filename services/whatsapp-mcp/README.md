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

The separate B2 backup loop will be added after the service and volume layout
have passed local tests.
