FROM restic/restic:0.18.1 AS restic-source

FROM mysql:9.6

# restic is a static Go binary (CGO_ENABLED=0) — works on any Linux regardless of libc
COPY --from=restic-source /usr/bin/restic /usr/local/bin/restic
RUN microdnf install -y curl && microdnf clean all

COPY backup.sh /usr/local/bin/backup
RUN chmod +x /usr/local/bin/backup

CMD ["backup"]
