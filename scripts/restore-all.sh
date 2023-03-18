#!/bin/sh
# This script is to be run from host, with the appropriate secrets.
# It assumes that no containers are running at the moment.
# Usage: ./restore-all.sh [snapshotId]

set -e

# Clear out anything in volumes folder; otherwise, we get conflicts
sudo rm -rf /var/lib/docker/volumes/*

# First, find the snapshot to restore to:
BACKUP_ID="${1:-latest}"

# Then, pass that snapshot id to restore volumes/ directory
# NOTE: we restore to the "root" directory of the backup container, which *seems* wrong;
# except that since restic backs up the /docker/volumes directory,
# the path at which the files will be restored at would be:
# ${prefix}/docker/volumes/${files}.
# So, we need the prefix to be the root.
echo 'Restoring from backup...'
make run SERVICE=backup COMMAND="restore --target / $BACKUP_ID"

# Finally, get the databases to ingest the restored WALs
# Note: wait-for apparently doesn't work, 127.0.0.1/0.0.0.0/localhost/etc
echo 'Restoring database states...'
make up SERVICE=mysql # we need to stand up mysql before we can tell it to read from the dump
make run SERVICE=mysql COMMAND=restore
make run SERVICE=redis COMMAND=restore # we do not need to stand up redis beforehand, as it simply reads from dump on startup
make run SERVICE=typesense COMMAND=restore # we restore from the typesense container, NOT the helper
