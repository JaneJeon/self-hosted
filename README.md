## Applications to self-host

- [ ] Blink app
- [ ] Blink worker
- [ ] Dokku?
- [ ] Postgres (use https://pgtune.leopard.in.ua/ to optimize config, https://github.com/wal-g/wal-g to backup)
- [ ] Redis
- [ ] ClickHouse (really need config https://theorangeone.net/posts/calming-down-clickhouse/)
- [ ] Caddy / nginx-proxy / hardened nginx (see stars)
- [ ] Watchtower
- [ ] Some container for automatic volume backups?
- [ ] bitwarden_rs (postgres)
- [ ] Keycloak (postgres) - use Keycloak.X image for lower mem!
- [ ] VPN + adblock OH GOD
- [ ] Gitea, because jesus christ GitHub and GitLab are bloated, I hate the "do everything" shit

Need to absolutely bulletproof the actual machine

### Private Applications
- [ ] Music server: https://github.com/deluan/navidrome
- [ ] VSCode Server?

## Infra
Use https://www.terraform.io/docs/language/settings/backends/pg.html and https://www.terraform.io/docs/language/modules/sources.html#github to avoid using TFE, and also host Vault to host all secrets.

Instrumentation with Prometheus + Grafana, APM w/ Jaeger (backed by Elasticsearch), Logs w/ Vector -> ES.

Use https://github.com/tricksterproxy/trickster to speed up prom + clickhouse queries

Observability for the DBs? Esp. regarding perf...

Auto-scanning registry w/ https://goharbor.io/docs/2.0.0/administration/vulnerability-scanning (backed by S3).

Centralized Swagger UI

Autoscale EC2 group, Amazon Linux 2 base (handles all auto-updates)

Envoy App Mesh

k8s + helm to manage app infra

Pipe docker-compose logs to syslog then vector

## Goals
Describe all the services as docker-compose.yml, and basically have infrasturcture as code for everything - including ansible deployments - so that I can recreate all of this any time I'd like (and restore from backup more easily - just backup the volumes)

## Reference
- https://github.com/DoTheEvo/selfhosted-apps-docker
- https://github.com/docker/awesome-compose
- https://medium.com/@ravindrashekhawat5876/keycloak-heap-size-management-on-kubernetes-8f504ccf40cd
- https://theorangeone.net/posts/backup-restore-containers/

### Hardening guides
- https://theorangeone.net/posts/securing-public-servers
- https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-18-04
- https://dev.to/phiilu/make-your-ubuntu-server-vps-more-secure-against-unauthorized-access-1e7c
- https://www.digitalocean.com/community/tutorials/how-to-configure-multi-factor-authentication-on-ubuntu-18-04
- https://github.com/CISOfy/lynis
- https://pornhub.com
