# MCP agentgateway

This is the only public Railway service for Telegram and WhatsApp MCP. Add the
custom domain `mcp.janejeon.dev` to this service and create its Cloudflare CNAME
as DNS-only. The public endpoints are `/telegram` and `/whatsapp`. Each has a
separate MCP backend and OAuth resource. Do not publish a domain for either
backend or the gateway admin listener.

Required variables:

| Name                | Value                                                 |
| ------------------- | ----------------------------------------------------- |
| `TELEGRAM_MCP_URL`  | `http://telegram-mcp.railway.internal:8080/mcp`       |
| `WHATSAPP_MCP_HOST` | `whatsapp-mcp.railway.internal`                       |
| `AUTH0_ISSUER`      | Auth0 tenant URL with a trailing slash                |
| `AUTH0_JWKS_URL`    | Auth0 tenant URL followed by `/.well-known/jwks.json` |
| `AUTH0_AUDIENCE`    | Identifier of the Auth0 API for this gateway          |
| `JANE_SUB`          | Stable Auth0 user ID allowed to use these tools       |

Agentgateway requires a valid Auth0 JWT with the `mcp:use` permission and the
configured Jane subject. The token is stripped before forwarding MCP traffic
to either backend. Keep dynamic client registration disabled in Auth0; configure
the Codex and Claude OAuth clients explicitly and register their exact callback
URLs. Configure the Auth0 API to include permissions in access tokens.

The admin listener binds to loopback on port 15000. The public MCP listener is
port 8080. Run `agentgateway --validate-only -f /config.yaml` against the built
image with test environment values before pushing.
