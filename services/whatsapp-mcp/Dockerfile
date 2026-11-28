FROM alpine:3.23 AS source

RUN apk add --no-cache ca-certificates git
ARG WHATSAPP_REF=d64bbdf1b4fad0a917ce783c9471d49a17f16a4c
RUN git init /src \
    && git -C /src remote add origin https://github.com/aldinokemal/go-whatsapp-web-multidevice.git \
    && git -C /src fetch --depth 1 origin "$WHATSAPP_REF" \
    && git -C /src checkout --detach FETCH_HEAD \
    && test "$(git -C /src rev-parse HEAD)" = "$WHATSAPP_REF"

FROM golang:1.25-alpine3.23 AS builder

RUN apk add --no-cache gcc musl-dev gcompat
WORKDIR /src
COPY --from=source /src/src/go.mod /src/src/go.sum ./
RUN go mod download
COPY --from=source /src/src ./
COPY mcp-result-compat.go mcp-result-compat_test.go ./ui/mcp/
RUN sed -i 's/mcp.NewToolResultStructured(/newStructuredResult(/g' \
    ui/mcp/query.go ui/mcp/app.go ui/mcp/group.go \
    && sed -i \
    -e 's/mcp.WithDescription("Retrieve all contacts available in the connected WhatsApp account.")/mcp.WithDescription(contactsDescription)/' \
    -e 's/mcp.WithDescription("Retrieve recent chats with optional pagination and search filters.")/mcp.WithDescription(chatsDescription)/' \
    -e 's/mcp.WithDescription("Fetch messages from a specific chat, with optional pagination, search, and time filters.")/mcp.WithDescription(messagesDescription)/' \
    ui/mcp/query.go \
    && go test ./ui/mcp
RUN go build -ldflags="-w -s" -o /out/whatsapp

FROM restic/restic:0.19.1 AS restic-source

FROM alpine:3.23

RUN apk add --no-cache coreutils curl ffmpeg libwebp-tools poppler-utils sqlite su-exec tzdata \
    && addgroup -g 20000 gowa \
    && adduser -D -u 20001 -G gowa -h /app gowauser

ENV TZ=UTC
WORKDIR /app
COPY --from=builder /out/whatsapp /app/whatsapp
COPY --from=restic-source /usr/bin/restic /usr/local/bin/restic
RUN mkdir -p /app/data \
    && ln -s /app/data/storages /app/storages \
    && ln -s /app/data/statics /app/statics
COPY entrypoint.sh /entrypoint.sh
COPY backup.sh backup-loop.sh /usr/local/bin/
RUN chmod +x /entrypoint.sh /usr/local/bin/backup.sh /usr/local/bin/backup-loop.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
