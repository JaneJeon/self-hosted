FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY monitor.mjs run.mjs tracker.mjs normalize.mjs window.mjs transitions.mjs caldav.mjs telegram.mjs store.mjs retry.mjs ./
CMD ["node", "monitor.mjs"]
