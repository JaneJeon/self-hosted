## Applications to self-host

- [ ] Blink app
- [ ] Blink worker
- [ ] Ghost w/ S3 & SQLite (backup just the file?)
- [ ] Postgres (use https://pgtune.leopard.in.ua/ to optimize config, https://github.com/wal-g/wal-g to backup)
- [ ] Redis
- [ ] ~~ClickHouse (really need config https://theorangeone.net/posts/calming-down-clickhouse, backup w/ https://github.com/AlexAkulov/clickhouse-backup, dont run own zookeeper)~~ too much operational burden
- [ ] Traefik for live service discovery
- [ ] Watchtower
- [ ] backups w/ restic, use https://github.com/Southclaws/restic-robot for integrated monitoring
- [ ] bitwarden_rs (postgres)
- [ ] Keycloak (postgres) - use Keycloak.X image for lower mem! clustering?? (semi-stateful)
- [ ] VPN + adblock OH GOD (WireGuard, https://pi-hole.net/)
- [ ] ~~Gitea, because jesus christ GitHub and GitLab are bloated, I hate the "do everything" shit~~
- [ ] ~~Plausible to track activity on public-facing apps~~ Screw this, just go with GA
- [ ] Portainer (stateful)
- [ ] qbittorrent (semi-stateful)
- [ ] vector (docker-compose logs via syslog, application log parsing) (semi-stateful)
- [ ] Terraform remote state w/ https://www.terraform.io/docs/language/settings/backends/pg.html and modules via https://www.terraform.io/docs/language/modules/sources.html#github
- [ ] Vault w/ DB
- [ ] Some sort of youtube-dl ~~& gallery-dl~~ server? (fuck gdl and its author)

If we're not hosting stateful services:

Use AWS for Redis/MySQL/S3, no need for volume backups - all containers should be stateless; use GA for analytics. Would need to rewrite Blink for MySQL as well. Currently the only service that is only MySQL or Postgres is:
- Blink (Postgres)
- Ghost (MySQL)
- Plausible (Postgres + ClickHouse)

Need to absolutely bulletproof the actual machine

Git push this entire repo up to remote server to update docker-compose.yml and related config files (taking care to NOT wipe out the data dirs), and run docker-compose up to refresh

Traefik set `Permissions-Policy: interest-cohort=()` header to block FLOC; disallow unauthenticated access to internal applications; plug in plausible script on everything

### Private Applications
- [ ] Music server: https://github.com/deluan/navidrome
- [ ] VSCode Server?

## Infra

Instrumentation with Prometheus + Grafana, APM w/ Jaeger (backed by Elasticsearch), Logs w/ Vector -> ES.

Use https://github.com/tricksterproxy/trickster to speed up prom + clickhouse queries

Observability for the DBs? Esp. regarding perf...

Autoscale EC2 group, Amazon Linux 2 base (handles all auto-updates)

- [ ] Auto-scanning registry w/ https://goharbor.io/docs/2.0.0/administration/vulnerability-scanning (scan w/ trivy, backed by S3).
- [ ] Centralized Swagger UI?

## Goals
Describe all the services as docker-compose.yml, and basically have infrasturcture as code for everything - including ansible deployments - so that I can recreate all of this any time I'd like (and restore from backup more easily - just backup the volumes)

## Reference
- https://github.com/DoTheEvo/selfhosted-apps-docker
- https://github.com/docker/awesome-compose
- https://medium.com/@ravindrashekhawat5876/keycloak-heap-size-management-on-kubernetes-8f504ccf40cd
- https://theorangeone.net/posts/backup-restore-containers/
- https://theorangeone.net/posts/containers-as-root/ (docker rootless)
- https://support.atlassian.com/opsgenie/docs/integrate-opsgenie-with-prometheus/ (alerting)

### Hardening guides
- https://theorangeone.net/posts/securing-public-servers
- https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-18-04
- https://dev.to/phiilu/make-your-ubuntu-server-vps-more-secure-against-unauthorized-access-1e7c
- https://www.digitalocean.com/community/tutorials/how-to-configure-multi-factor-authentication-on-ubuntu-18-04
- https://github.com/CISOfy/lynis
- https://pornhub.com
