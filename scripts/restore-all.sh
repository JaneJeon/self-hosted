#!/bin/sh
# This script is to be run from host, with the appropriate secrets.

set -e

# Clear out anything in volumes folder; otherwise, we get conflicts
sudo rm -rf ./volumes/*

# First, find the snapshot to restore to:
make run SERVICE=backup COMMAND=snapshots

read -p "Select backup ID: " BACKUP_ID

# Then, pass that snapshot id to restore volumes/ directory
make run SERVICE=backup COMMAND="restore --target / $BACKUP_ID"

# Finally, get the databases to ingest the restored WALs
# Note: wait-for apparently doesn't work, 127.0.0.1/0.0.0.0/localhost/etc
make run SERVICE=redis COMMAND=restore
make run SERVICE=mysql COMMAND=restore

# Chown this to prevent privilege problems with docker and rsync
sudo chown -R $USER ./volumes
