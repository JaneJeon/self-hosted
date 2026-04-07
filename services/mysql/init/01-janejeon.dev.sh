#!/bin/bash
# Creates the Ghost blog database and user.
# Runs once on first startup with an empty data directory.
# Requires MYSQL_ROOT_PASSWORD and GHOST_DB_PASSWORD env vars.
set -e

mysql -u root -p"${MYSQL_ROOT_PASSWORD}" <<EOSQL
CREATE DATABASE IF NOT EXISTS devblog;
CREATE USER IF NOT EXISTS 'ghost-devblog'@'%' IDENTIFIED WITH caching_sha2_password BY '${GHOST_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON devblog.* TO 'ghost-devblog'@'%';
EOSQL
