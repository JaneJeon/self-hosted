FROM quay.io/keycloak/keycloak:26.7.4 AS builder
ENV KC_DB=mysql KC_HEALTH_ENABLED=true KC_HTTP_RELATIVE_PATH=/auth
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.7.4
COPY --from=builder /opt/keycloak/ /opt/keycloak/
ENV KC_DB=mysql KC_HEALTH_ENABLED=true \
    KC_HTTP_ENABLED=true KC_HTTP_PORT=8080 KC_HTTP_RELATIVE_PATH=/auth \
    KC_PROXY_HEADERS=xforwarded \
    KC_HOSTNAME=https://mcp.janejeon.dev/auth \
    JAVA_OPTS_KC_HEAP="-Xms128m -Xmx512m"
EXPOSE 8080
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
