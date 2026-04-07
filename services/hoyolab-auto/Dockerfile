FROM ghcr.io/torikushiii/hoyolab-auto:latest

# Image runs as non-root 'hoyolab'; switch to root to install packages
USER root
RUN apk add --no-cache gettext
USER hoyolab

# Copy template (envsubst syntax: $VAR)
COPY --chown=hoyolab:hoyolab config.json5.envsubst /app/config.json5.template

# Render config at startup, then start app
CMD ["sh", "-c", "envsubst '$TELEGRAM_CHAT_ID $TELEGRAM_NOTIFICATIONS_BOT_TOKEN $HOYOLAB_COOKIE' < /app/config.json5.template > /app/config.json5 && exec npm start"]
