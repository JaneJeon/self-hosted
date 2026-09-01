# --platform is required, not cosmetic. The upstream image is published amd64
# only (JaneJeon/hoyolab-auto .github/workflows/docker-image.yaml), because
# Railway runs x86-64 and the emulated arm64 leg was half the build's wall clock
# and where a build once hung. Without this line, `docker build` on an Apple
# Silicon Mac fails with "no match for platform in manifest", which breaks the
# pre-push hook and golden rule 2 for everyone on arm64 hardware.
FROM --platform=linux/amd64 ghcr.io/janejeon/hoyolab-auto:sha-c2f73e8

# Image runs as non-root 'hoyolab'; stay as root to install packages and run entrypoint
USER root
RUN apk add --no-cache gettext su-exec

# Copy template (envsubst syntax: $VAR)
COPY --chown=hoyolab:hoyolab config.json5.envsubst /app/config.json5.template

# Fix volume mount ownership (volume dirs are created as root), render config,
# then drop to unprivileged user to run the app
CMD ["sh", "-c", "chown hoyolab:hoyolab /app/data && \
    envsubst '$TELEGRAM_CHAT_ID $TELEGRAM_NOTIFICATIONS_BOT_TOKEN $HOYOLAB_COOKIE $KUMA_PUSH_URL_LIVENESS $KUMA_PUSH_URL_LTOKEN $KUMA_PUSH_URL_COOKIE_TOKEN' < /app/config.json5.template > /app/config.json5 && \
    exec su-exec hoyolab npm start"]
