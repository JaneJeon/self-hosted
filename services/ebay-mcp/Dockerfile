FROM node:24-alpine AS build

RUN apk add --no-cache git
ARG EBAY_REF=124d5535fd5b8d8b089081e533343d2212557013
RUN git init /src \
    && git -C /src remote add origin https://github.com/eBay/npm-public-api-mcp.git \
    && git -C /src fetch --depth 1 origin "$EBAY_REF" \
    && git -C /src checkout --detach FETCH_HEAD \
    && test "$(git -C /src rev-parse HEAD)" = "$EBAY_REF"
WORKDIR /src
COPY path-variables.patch /tmp/path-variables.patch
RUN git apply --check /tmp/path-variables.patch \
    && git apply /tmp/path-variables.patch
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-alpine

RUN npm install --global --ignore-scripts --no-audit --no-fund mcp-proxy@6.7.19
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/dist ./dist
COPY --from=build /src/node_modules ./node_modules
COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint

ENV EBAY_API_ENV=production EBAY_TOKEN_TYPE=application
USER node
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["mcp-proxy", "--server", "stream", "--port", "8080", "--", "node", "/app/dist/index.js"]
