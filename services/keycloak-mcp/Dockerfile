FROM quay.io/sshaaf/keycloak-mcp-server@sha256:b7e9cba72f8a531c888792f204289fc2c7a373c9e74b04776e5ffb33fe468d80

# Validate the user's JWT and use it for Keycloak's own authorization checks.
# Discovery advertises public URLs; fetch JWKS over private networking instead.
ENV KC_REALM=personal \
    QUARKUS_OIDC_DISCOVERY_ENABLED=false \
    QUARKUS_OIDC_JWKS_PATH=/protocol/openid-connect/certs \
    QUARKUS_TLS_TRUST_ALL=false \
    QUARKUS_HTTP_AUTH_PERMISSION_MCP_PATHS="/mcp,/mcp/*" \
    KEYCLOAK_MCP_COMMANDS_ENABLE_ALL_BY_DEFAULT=false \
    KEYCLOAK_MCP_COMMANDS_ENABLED=GET_REALM,GET_CLIENTS

EXPOSE 8080
