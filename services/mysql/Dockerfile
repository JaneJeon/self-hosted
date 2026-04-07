FROM mysql:8.4.6

ARG GHOST_MYSQL_DATABASE
ARG GHOST_MYSQL_USERNAME
ARG GHOST_MYSQL_PASSWORD
ARG UPTIME_KUMA_MYSQL_DATABASE
ARG UPTIME_KUMA_MYSQL_USERNAME
ARG UPTIME_KUMA_MYSQL_PASSWORD

COPY my.cnf /etc/mysql/conf.d/my.cnf
COPY init/ /tmp/init/

RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && for f in /tmp/init/*.envsubst; do \
         envsubst '$GHOST_MYSQL_DATABASE $GHOST_MYSQL_USERNAME $GHOST_MYSQL_PASSWORD $UPTIME_KUMA_MYSQL_DATABASE $UPTIME_KUMA_MYSQL_USERNAME $UPTIME_KUMA_MYSQL_PASSWORD' \
           < "$f" > "/docker-entrypoint-initdb.d/$(basename "${f%.envsubst}")"; \
         done \
    && apt-get purge -y --auto-remove gettext-base \
    && rm -rf /var/lib/apt/lists/* /tmp/init
