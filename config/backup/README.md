Restic to backup stateful docker volumes

Backup strategies:

- for stateful, non-database containers, just backup the docker volume
- for the DB's (MySQL/Redis/Prometheus/Elasticsearch) where things aren't necessarily guaranteed to flush to disk, snapshot + restore, _then_ backup that snapshot with restic.

Restoring process:

- for stateful, non-database containers, restore directly from restic/bivac
- for the DB's, restore the snapshot into local docker volume, _then_ restore from local volume to their respective DB's using their built-in restore solution.
