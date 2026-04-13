FROM grafana/grafana-image-renderer:v5.8.1

# Bridge Railway PORT to renderer's SERVER_ADDR (same ARG/ENV pattern as tailscale)
ARG PORT
ENV SERVER_ADDR=:${PORT}

# Memory optimization: cap viewport (default 3000x3000)
ENV BROWSER_MAX_WIDTH=1920
ENV BROWSER_MAX_HEIGHT=1080

# Chrome flags for low-memory containers:
# --disable-dev-shm-usage: use /tmp instead of /dev/shm (Docker default is 64MB, causes Chrome crashes)
# --no-sandbox: required in Docker without CAP_SYS_ADMIN
# --disable-extensions: no extensions needed
ENV BROWSER_FLAG=--disable-dev-shm-usage,--no-sandbox,--disable-extensions

# Silence healthcheck request logs
ENV API_SILENCE_REQUEST_LOG_PATH=/healthz
