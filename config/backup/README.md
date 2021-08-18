Restic to backup stateful docker volumes

Use Bivac to automate some of the shit

Backup strategies:

- for stateful, non-database containers, just backup the docker volume
- for _transactional_ DB's (MySQL/Redis), use wal-g to incrementally backup and restore, without touching restic.
- for _analytical_ DB's (Prometheus/Elasticsearch), snapshot + restore, _then_ backup that snapshot with restic.

Restoring process:

- for stateful, non-database containers, restore directly from restic/bivac
- for _transactional_ DB's, restore directly from wal-g
- for _analytical_ DB's, restore the snapshot into local docker volume, _then_ restore from local volume to their respective DB's using their built-in restore solution.
