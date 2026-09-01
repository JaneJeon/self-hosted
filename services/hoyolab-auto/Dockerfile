FROM ghcr.io/janejeon/hoyolab-auto:sha-79ca0c4

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
