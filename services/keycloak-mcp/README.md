# Keycloak management MCP

Pinned community [Keycloak MCP server](https://github.com/sshaaf/keycloak-mcp-server)
0.4.0, with its image pinned by digest. As of September 30, 2026, this private
Railway service is live behind `https://mcp.janejeon.dev/keycloak`. Native Codex
OAuth login and `GET_REALM` succeeded against production. It permits only
`GET_REALM` and `GET_CLIENTS` for initial dogfooding.
The upstream tool schema also lists disabled operations; the server rejects
them before execution.

The image preserves the upstream JVM logging/default options and appends an
explicit 64 MiB initial / 256 MiB maximum heap. The original 80% RAM setting
sized a very large heap against the Railway host and the deployed Java process
used about 1.7 GiB RSS. An explicit heap prevents that sizing behavior. Measure
the deployed RSS and exercise both enabled reads after changes; the heap limit
is not a total-process memory limit.

The service uses the caller's Keycloak JWT for administration. It has no shared
administrator password or service account. Keycloak must separately grant the
caller the appropriate `realm-management` view roles. Restrict the public gateway
route to Jane's subject, and configure the target's `backendAuth.passthrough` so
the validated token reaches this server. Keep this service private.

Runtime configuration:

| Variable                    | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| `KC_URL`                    | `http://${{keycloak.RAILWAY_PRIVATE_DOMAIN}}:8080/auth` |
| `KC_REALM`                  | `personal`                                              |
| `QUARKUS_OIDC_TOKEN_ISSUER` | `https://mcp.janejeon.dev/auth/realms/personal`         |
| `OIDC_CLIENT_ID`            | Registered public MCP client ID                         |

The image overrides upstream's trust-all TLS default and requires authentication
on both `/mcp` and `/mcp/*`. Its JWKS URL uses the private Keycloak address, while
issuer validation uses the public URL.

Call `executeKeycloakOperation` with
`{"operation":"GET_REALM","params":"{\"realmName\":\"personal\"}"}`
to inspect the realm. A disabled write and a caller without view roles must fail.
