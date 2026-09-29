# Keycloak for personal MCP

This is the production container candidate for replacing Auth0. It is not yet
connected to Railway. Keycloak uses a separate `keycloak` database and account
in the existing MySQL 8.4 service. The existing all-databases backup includes
that database once provisioned. No additional volume is needed.

Run one replica. Supply `KC_DB_URL`, `KC_DB_USERNAME`, and `KC_DB_PASSWORD`
at runtime. Supply bootstrap administrator credentials only for provisioning.
Store new credentials in 1Password before activating this service. Do not use
the development server or its embedded database in Railway.

Agentgateway will expose only the personal realm, public discovery, and login
assets under `/auth`. Keep `/auth/admin`, the master realm, and port 9000 private.
The proxy must overwrite forwarded protocol, host, and port headers. Keycloak's
fixed public hostname is `https://mcp.janejeon.dev/auth`.

Use a dedicated `personal` realm, disabled public signup, registered public
clients, exact callbacks, and S256 PKCE. Disable password grants and service
accounts for desktop clients. Authorize Jane's subject at the gateway.

## Why direct discovery

A local test with Codex 0.154.0, agentgateway 1.5.0, and Keycloak 26.7.1 found
that `provider.keycloak` rewrites the discovered issuer to the gateway URL,
while Keycloak returns its own issuer in the OAuth callback. Codex rejects the
mismatch. Removing the provider adapter makes protected resource metadata point
directly to Keycloak. Native OAuth login, tool discovery, and a read-only tool
call then succeeded. Keep explicit JWKS configuration and required JWT claims.

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
