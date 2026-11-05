FROM alpine:3.24 AS source
RUN apk add --no-cache ca-certificates git
ARG WHATSAPP_REF=895404542017f34a900f9f572a5497c275a96440
RUN git init /src \
    && git -C /src remote add origin https://github.com/verygoodplugins/whatsapp-mcp.git \
    && git -C /src fetch --depth 1 origin "$WHATSAPP_REF" \
    && git -C /src checkout --detach FETCH_HEAD \
    && test "$(git -C /src rev-parse HEAD)" = "$WHATSAPP_REF"

FROM ghcr.io/astral-sh/uv:0.12.13 AS uv-source
FROM python:3.13-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 20000 whatsapp \
    && useradd --uid 20001 --gid whatsapp --home-dir /app --no-create-home whatsapp
COPY --from=uv-source /uv /usr/local/bin/uv
COPY --from=source /src/whatsapp-mcp-server/ /app/mcp/
WORKDIR /app/mcp
RUN uv sync --frozen --no-dev --python /usr/local/bin/python3
ENV PATH=/app/mcp/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
COPY serve.py /app/mcp/trial_serve.py
COPY seed.py /app/seed.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/data
WORKDIR /app
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
