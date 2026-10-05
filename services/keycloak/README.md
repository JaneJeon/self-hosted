# Keycloak for personal MCP

## Permanent username/password identity

`provision-user.py` provisions the authorized identity from direnv variables
`MCP_PERMANENT_USERNAME`, `MCP_PERMANENT_PASSWORD`, `MCP_PERMANENT_FIRST_NAME`,
and `MCP_PERMANENT_LAST_NAME`. It preserves an existing identity's password,
assigns only MCP use and the management read roles, and records its subject in
the ignored `.env`. Email is optional in the dedicated personal realm; public
registration and password reset remain disabled. Secrets travel through stdin.

The browser account page is
`https://mcp.janejeon.dev/auth/realms/personal/account/`. The private hostname
redirects to this canonical public hostname because Keycloak uses one fixed
issuer/origin for OAuth. The account page manages the user's own account;
the master realm and administrative web API remain private.

This production container replaces Auth0 for the migration. The private
Railway service is declared in `.railway/railway.ts`. Keycloak uses a separate `keycloak` database and account
in the existing MySQL 8.4 service. The existing all-databases backup includes
that database once provisioned. No additional volume is needed.

Run one replica. Supply `KC_DB_URL`, `KC_DB_USERNAME`, and `KC_DB_PASSWORD`
at runtime. Supply bootstrap administrator credentials only for provisioning.
Store permanent credentials in 1Password. During the user-authorized temporary
account phase, generated credentials are held in Railway variables and the
ignored, owner-readable `services/keycloak/.env`. Do not use
the development server or its embedded database in Railway.

Agentgateway will expose only the personal realm, public discovery, and login
assets under `/auth`. Keep `/auth/admin`, the master realm, and port 9000 private.
The proxy must overwrite forwarded protocol, host, and port headers. Keycloak's
fixed public hostname is `https://mcp.janejeon.dev/auth`.

Use a dedicated `personal` realm, disabled public signup, registered public
clients, exact callbacks, and S256 PKCE. Disable password grants and service
accounts for desktop clients. Authorize Jane's subject at the gateway.

`personal-realm.json` seeds those settings on first startup. Existing realms
are skipped, so later changes require an explicit administrative update.
The `basic` default client scope supplies the required `sub` claim. Each client
keeps full-scope access disabled and explicitly permits `mcp-use` plus the three
realm/client view roles. User role assignment alone does not put those roles in
a token when the client's scope mappings exclude them. The provisioning script
reconciles these settings for existing clients too.
No user or password is embedded. Provision Jane using her saved login, assign
`mcp-use`, and grant the appropriate realm view roles for management MCP.
Record her new Keycloak subject in the gateway before activation. Codex uses
client ID `codex` and callback port 8765. Claude uses client ID `claude`, without
a client secret. Verify Claude's published callback against its actual login
request before cutover.

## Temporary test account

Jane authorized a temporary account while she is away from her computer.
`provision-test-user.py` creates `migration-test` in the personal realm and
grants `mcp-use` plus the realm/client view roles needed by the management MCP.
It uses the temporary bootstrap service account through private requests from
the existing WhatsApp container. Credentials are passed through stdin and are
never printed. It records the returned subject in the ignored `.env`.

Run after Keycloak has started:

```sh
direnv exec services/keycloak python3 services/keycloak/provision-test-user.py
```

Switch the gateway's allowed subject to the returned test subject before testing.
The test user is a real authorization principal, so use its generated password
and keep public signup disabled. Do not use a fixed example password.

When Jane returns, create her permanent account, enroll the desired login
method, assign its roles, and test a separate login. Switch the gateway's allowed
subject to that account, revoke the test user's sessions, and remove the test
account. Store database and permanent administrative credentials in 1Password.
Remove the temporary bootstrap client after permanent administrative access
has been established. Move `.env` to the normal swarp template workflow then.

When adding these services to Railway, use reference variables for every
service dependency. Build `KC_DB_URL` from MySQL's private domain and database
variable, and reference MySQL's dedicated Keycloak username/password variables.
Build gateway and management MCP URLs from Keycloak's `RAILWAY_PRIVATE_DOMAIN`.
This keeps values linked and shows the dependency in Railway's canvas. See
`.railway/README.md`.

## Why direct discovery

A local test with Codex 0.154.0, agentgateway 1.5.0, and Keycloak 26.7.1 found
that `provider.keycloak` rewrites the discovered issuer to the gateway URL,
while Keycloak returns its own issuer in the OAuth callback. Codex rejects the
mismatch. Removing the provider adapter makes protected resource metadata point
directly to Keycloak. Native OAuth login, tool discovery, and a read-only tool
call then succeeded. Keep explicit JWKS configuration and required JWT claims.

The same native login and read test subsequently passed against the production
26.7.4 image with MySQL 8.4 and login served under the gateway's `/auth` path.
The management MCP also completed a realm read using that user's token.

The gateway configuration lives in `services/agentgateway/config.yaml`. It requires `OIDC_ISSUER`
(`https://mcp.janejeon.dev/auth/realms/personal`), `OIDC_JWKS_URL`
(`http://keycloak.railway.internal:8080/auth/realms/personal/protocol/openid-connect/certs`),
`KEYCLOAK_HOST` (`keycloak.railway.internal:8080`), `KEYCLOAK_MCP_URL`
(`http://keycloak-mcp.railway.internal:8080/mcp`), and `MCP_ALLOWED_SUB`, alongside the
existing Telegram and WhatsApp private URLs. It exposes no master realm or
administrative web endpoints. Forwarded client IP headers are stripped; use
gateway access logs for the original client address.

Deploy Keycloak and provision the realm before changing the live gateway.
Agentgateway exits if its initial JWKS fetch fails, so enable ongoing restart
retries for the gateway when adding the identity service dependency.

The upstream [standalone authentication reference](https://agentgateway.dev/docs/standalone/latest/documentation/configuration/security/mcp-authn/)
documents this resource server mode. The
[Keycloak guide](https://agentgateway.dev/docs/standalone/latest/integrations/auth/keycloak/)
explains the audience mapper. Configure the mapper explicitly because the
resource parameter alone does not supply the expected audience in this setup.

## Activation gate

Before cutover, provision the database and realm, save credentials, test OAuth
through the real HTTPS gateway in both native clients, and test rejection of
missing, expired, wrong-audience, and unauthorized-user tokens. A local fixture
is evidence for the protocol configuration, not completion of the migration.
