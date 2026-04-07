#!/bin/sh
set -e

# Configure rclone for B2 via env vars (no config file needed)
export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_ACCOUNT="${B2_APPLICATION_KEY_ID}"
export RCLONE_CONFIG_B2_KEY="${B2_APPLICATION_KEY}"

# Dump all databases
mysqldump -h "${MYSQL_HOST}" -u root -p"${MYSQL_ROOT_PASSWORD}" --opt --all-databases > /tmp/dump.sql

# Upload to B2
rclone copy /tmp/dump.sql "b2:${B2_BUCKET}/mysql-backups/$(date +%Y-%m-%d_%H%M%S).sql"

rm /tmp/dump.sql

# Send heartbeat on success
curl -fsS "${HEARTBEAT_URL}" > /dev/null || true
