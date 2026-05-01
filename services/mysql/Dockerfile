FROM alpine:3.23 AS init-renderer
RUN apk add --no-cache gettext

ARG GHOST_MYSQL_DATABASE
ARG GHOST_MYSQL_USERNAME
ARG GHOST_MYSQL_PASSWORD
ARG UPTIME_KUMA_MYSQL_DATABASE
ARG UPTIME_KUMA_MYSQL_USERNAME
ARG UPTIME_KUMA_MYSQL_PASSWORD

COPY init/ /tmp/init/
RUN mkdir /rendered && \
    for f in /tmp/init/*.envsubst; do \
      envsubst '$GHOST_MYSQL_DATABASE $GHOST_MYSQL_USERNAME $GHOST_MYSQL_PASSWORD $UPTIME_KUMA_MYSQL_DATABASE $UPTIME_KUMA_MYSQL_USERNAME $UPTIME_KUMA_MYSQL_PASSWORD' \
        < "$f" > "/rendered/$(basename "${f%.envsubst}")"; \
    done

FROM mysql:8.4.8

# jemalloc eliminates ~3-4 MB/day RSS growth from glibc malloc fragmentation (see README § Memory)
RUN microdnf install -y oracle-epel-release-el9 \
    && microdnf install -y jemalloc \
    && microdnf clean all
ENV LD_PRELOAD=/usr/lib64/libjemalloc.so.2

COPY my.cnf /etc/mysql/conf.d/my.cnf
COPY --from=init-renderer /rendered/ /docker-entrypoint-initdb.d/
