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

During migration, only the generated `migration-test` identity is authorized.
When Jane's permanent account is ready, switch `MCP_ALLOWED_SUB`, verify its
login, and revoke/remove the temporary user's sessions and account.

Codex uses OAuth client ID `codex` with callback port 8765. Claude uses client ID
`claude` and no secret. The realm seed declares exact callbacks. Verify Claude's
actual authorization request before considering that connector complete.

Agentgateway exits when its initial JWKS fetch fails. Railway therefore uses
`ALWAYS` restart behavior so the gateway recovers when Keycloak becomes available.
Existing Auth0 configuration variables are retained temporarily for rollback.

See `services/keycloak/README.md` for the tested direct-discovery rationale and
identity provisioning procedure. Build and run the image locally before pushing.
