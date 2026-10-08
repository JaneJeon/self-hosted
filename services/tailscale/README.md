# Railway private router and Keycloak console

The existing router retains its `/var/lib` volume, subnet routes, health/metrics
settings and credentials. `TS_AUTH_ONCE=true` reuses its persisted identity after
rollouts. Railway supplies the auth key at runtime; it is not baked into the image.

`serve.json` configures private HTTPS port 8443 and proxies the Keycloak service.
The pinned container expands `${TS_CERT_DOMAIN}` using its existing HTTPS name.
Tailscale Serve terminates TLS and sets forwarded host/protocol headers. Funnel
is disabled, so the console remains reachable through the tailnet.

`KEYCLOAK_ADMIN_URL` supplies Keycloak's `KC_HOSTNAME_ADMIN` through a Railway
reference. The private master realm frontend must use this same URL; public
personal MCP login continues to use `mcp.janejeon.dev`.

The IaC partial preserves all existing router variables and its `rat-volume`.
Its stored Nixpacks/V3 build metadata is preserved; `railway.json` selects the
standard Dockerfile. GitHub source Wait for CI is enabled before service-code
changes. No new node or auth key is needed for this console.

See [Keycloak browser administration](../keycloak/README.md#private-browser-administration)
for the actual URL, owner login and private provisioning procedure.
