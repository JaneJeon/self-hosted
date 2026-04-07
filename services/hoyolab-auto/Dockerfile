FROM ghcr.io/torikushiii/hoyolab-auto:latest

ARG TZ=America/Los_Angeles
ENV TZ=$TZ

# Image runs as non-root 'hoyolab'; stay as root to install packages and run entrypoint
USER root
RUN apk add --no-cache gettext su-exec

# Copy template (envsubst syntax: $VAR)
COPY --chown=hoyolab:hoyolab config.json5.envsubst /app/config.json5.template

# Fix volume mount ownership (volume dirs are created as root), render config,
# then drop to unprivileged user to run the app
CMD ["sh", "-c", "chown hoyolab:hoyolab /app/data && envsubst '$TELEGRAM_CHAT_ID $TELEGRAM_NOTIFICATIONS_BOT_TOKEN $HOYOLAB_COOKIE' < /app/config.json5.template > /app/config.json5 && exec su-exec hoyolab npm start"]
