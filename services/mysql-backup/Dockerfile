FROM alpine:3.21
RUN apk add --no-cache mysql-client rclone curl

COPY backup.sh /usr/local/bin/backup
RUN chmod +x /usr/local/bin/backup

CMD ["backup"]
