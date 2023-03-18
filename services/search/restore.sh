#!/bin/sh

# https://typesense.org/docs/guide/backups.html#restore-steps
# Since we snapshotted the whole /backup folder "as-is",
# we can simply move the contents over to the /data directory once the /backup is restored.

echo 'Restoring Typesense database...'
cp -a /backup/. /data
