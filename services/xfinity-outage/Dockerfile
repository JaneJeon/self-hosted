FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY monitor.mjs ./
CMD ["node", "monitor.mjs"]
