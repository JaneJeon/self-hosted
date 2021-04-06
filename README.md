## Applications to self-host

- [ ] Lynx app
- [ ] Lynx worker
- [ ] Dokku?
- [ ] Postgres
- [ ] Redis
- [ ] Caddy
- [ ] Watchtower
- [ ] Some container for automatic volume backups?
- [ ] bitwarden_rs (postgres)
- [ ] Keycloak (postgres)

Monitor w/ new relic, inject new relic "generic" container proc to prebuilt images (like Keycloak) and also use it to monitor the host itself, use agent for Lynx, pipe docker-compose logs to new relic as well.

Need to absolutely bulletproof the actual machine

### Private Applications
- [ ] Music server: https://github.com/deluan/navidrome
- [ ] VSCode Server?

## Goals
Describe all the services as docker-compose.yml, and basically have infrasturcture as code for everything - including ansible deployments - so that I can recreate all of this any time I'd like (and restore from backup more easily - just backup the volumes)

## Reference
- https://github.com/DoTheEvo/selfhosted-apps-docker
- https://github.com/docker/awesome-compose
