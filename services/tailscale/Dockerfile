FROM tailscale/tailscale:v1.102.5

ARG TS_LOCAL_ADDR_PORT
ENV TS_LOCAL_ADDR_PORT=$TS_LOCAL_ADDR_PORT

ARG TS_ROUTES
ENV TS_ROUTES=$TS_ROUTES

ARG TS_STATE_DIR
ENV TS_STATE_DIR=$TS_STATE_DIR

ENV TS_ENABLE_HEALTH_CHECK=true
ENV TS_ENABLE_METRICS=true

ENV TS_EXTRA_ARGS='--accept-routes'

# Credentials are supplied at runtime; never bake the auth key into the image.
COPY serve.json /config/serve.json
ENV TS_AUTH_ONCE=true TS_SERVE_CONFIG=/config/serve.json
