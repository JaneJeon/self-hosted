# Personal MCP gateway

The only public Railway entry point is `https://mcp.janejeon.dev`:

- `/telegram` and `/whatsapp`: private messaging MCP backends.
- `/keycloak`: the restricted identity management MCP.
- `/auth/realms/personal/` and login assets: Keycloak login and discovery.

Keep both messaging backends and both identity services private. The Keycloak
master realm, administrative web API, and management ports are not publicly
routed. The gateway admin listener binds only to loopback on port 15000.

The gateway acts as an OAuth resource server. Clients discover Keycloak directly,
use registered public clients with S256 PKCE, and send access tokens to the
gateway. Require issuer, audience, subject, and expiration claims, the configured
`MCP_ALLOWED_SUB`, and the `mcp-use` realm role. Messaging backends receive no
Authorization header. Only the Keycloak management backend receives the validated
user token, so Keycloak can enforce that user's view permissions.

WhatsApp's route uses `statefulMode: stateless`. In pinned v1.5.0, the legacy
SSE client caches its active transport even after that transport reaches EOF.
Later calls on that session fail with `upstream closed on receive`. The
stateless route creates a fresh initialized upstream transport per request;
WhatsApp's durable account/chat state remains in its own backend. This prevents
later requests from inheriting a dead transport after a rollout. It does not
retry an interrupted in-flight operation whose outcome could be unknown.

`python3 tests/test-sse-reconnect.py` reproduces the original same-session HTTP
500 against the pinned image, verifies fresh backend/session controls, and
checks the stateless route survives the same closure without a gateway restart.
The WhatsApp service's real-binary integration separately verifies its tool
inventory and result content across a backend restart.

All service dependencies use Railway references in `.railway/railway.ts`:

| Variable            | Source                                 |
| ------------------- | -------------------------------------- |
| `TELEGRAM_MCP_URL`  | Telegram MCP's `MCP_URL`               |
| `WHATSAPP_MCP_HOST` | Whatsapp MCP's private domain          |
| `OIDC_ISSUER`       | Keycloak's `ISSUER`                    |
| `OIDC_JWKS_URL`     | Keycloak's private `JWKS_URL`          |
| `KEYCLOAK_HOST`     | Keycloak's `PRIVATE_HOST`              |
| `KEYCLOAK_MCP_URL`  | Keycloak MCP's `MCP_URL`               |
| `MCP_ALLOWED_SUB`   | The single authorized Keycloak user ID |

The permanent `Jane` username/password identity is now the authorized subject.
Its password source is the 1Password `MCP Gateway Auth` item. Keep the configured
subject in sync with the account returned by Keycloak. Identity transitions
require fresh native client logins and reads before revoking the prior account.

Codex uses OAuth client ID `codex` with callback port 8765. Claude uses client ID
`claude` and no secret. The realm seed declares exact callbacks. Verify Claude's
actual authorization request before considering that connector complete.

Agentgateway exits when its initial JWKS fetch fails. Railway therefore uses
`ALWAYS` restart behavior so the gateway recovers when Keycloak becomes available.
Existing Auth0 configuration variables are retained temporarily for rollback.

See `services/keycloak/README.md` for the tested direct-discovery rationale and
identity provisioning procedure. Build and run the image locally before pushing.
