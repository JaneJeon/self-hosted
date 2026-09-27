FROM alpine:3.23 AS source

RUN apk add --no-cache ca-certificates git
ARG TELEGRAM_REF=0b1e2b48fd80b5f6d3688779043c6dd891a905b2
RUN git init /src \
    && git -C /src remote add origin https://github.com/chigwell/telegram-mcp.git \
    && git -C /src fetch --depth 1 origin "$TELEGRAM_REF" \
    && git -C /src checkout --detach FETCH_HEAD \
    && test "$(git -C /src rev-parse HEAD)" = "$TELEGRAM_REF"

FROM python:3.13-alpine

RUN apk add --no-cache nodejs npm su-exec \
    && pip install --no-cache-dir uv==0.12.13 \
    && npm install --global --no-audit --no-fund mcp-proxy@6.7.19

WORKDIR /app
COPY --from=source /src/pyproject.toml /src/uv.lock /src/README.md /src/main.py /src/session_string_generator.py ./
RUN uv sync --frozen --no-dev \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir /data \
    && chown -R app:app /app /data

COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

ENV PYTHONUNBUFFERED=1 UV_NO_PROGRESS=1
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint"]
CMD ["mcp-proxy", "--server", "stream", "--port", "8080", "--", "/app/.venv/bin/python", "-u", "/app/main.py", "/data"]
