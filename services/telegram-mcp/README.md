# Telegram MCP

This service runs the pinned upstream Telegram MCP server unchanged. The pinned
`mcp-proxy` process holds one upstream stdio session and serves Streamable HTTP
at `/mcp` on port 8080. Only Railway private networking should reach this port;
the public entry point is agentgateway.

Runtime variables: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and
`TELEGRAM_SESSION_STRING`. Store their source values in 1Password and inject
them into Railway with `railway variable set KEY --stdin`. Do not put them in
build arguments, Git, command lines, or logs.
The `Railway Telegram MCP` item is the source of truth, and `.env.template`
resolves it locally through `swarp secrets refresh`.

Mount one Railway volume at `/data`. Upstream file-path tools are restricted to
that server-side root and cannot access files on a desktop client. The session
string is supplied at runtime, so the Telegram authorization state does not
depend on the volume. Run one replica and stop the local server before starting
this copy of the same Telegram session.

Build and run locally before each push. `/ping` checks the HTTP adapter; an MCP
tool call is still needed to verify the Telegram account is authorized.

## Replacing an authorization session

Terminate the old authorization in Telegram's Devices settings and save the
replacement in the existing 1Password item. Changing Railway's variable does
not reconnect the already-running upstream process. Set the replacement through
stdin with `--skip-deploys`, then deploy through this repository's GitOps path.
After startup, make an authenticated account read through the gateway. A healthy
HTTP adapter or successful tool discovery does not prove the session works.

The incident record is the Craft [Railway env var breach response Index](https://docs.craft.do/editor/d/53687cd7-874b-cff7-84ed-3a082a04cb77/5f8e4e12-cd52-bc9b-0454-3368f2cb8484).
