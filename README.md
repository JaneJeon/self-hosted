## Applications to self-host

- [ ] Lynx app
- [ ] Lynx worker
- [ ] Dokku?
- [ ] Postgres (use https://pgtune.leopard.in.ua/ to optimize config)
- [ ] Redis
- [ ] Caddy
- [ ] Watchtower
- [ ] Some container for automatic volume backups?
- [ ] bitwarden_rs (postgres)
- [ ] Keycloak (postgres) - use Keycloak.X image for lower mem!
- [ ] VPN + adblock OH GOD

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
- https://medium.com/@ravindrashekhawat5876/keycloak-heap-size-management-on-kubernetes-8f504ccf40cd

### Hardening guides
- https://www.digitalocean.com/community/tutorials/initial-server-setup-with-ubuntu-18-04
- https://dev.to/phiilu/make-your-ubuntu-server-vps-more-secure-against-unauthorized-access-1e7c
- https://www.digitalocean.com/community/tutorials/how-to-configure-multi-factor-authentication-on-ubuntu-18-04
- https://github.com/CISOfy/lynis
- https://pornhub.com
