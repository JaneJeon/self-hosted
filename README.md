## Applications to self-host on a VPS
- [ ] Ghost 2x (MySQL) - no fucking SSO yet, the devs are being piece of shit about this. Is there really no way to easily move to JAMStack?
- [ ] Analytics for said Ghost 2x: https://github.com/mikecao/umami (MySQL | Postgres)
- [ ] Remark42 (GitHub integration, no DB, >1 bus factor)
- [ ] Lynx (MySQL or Postgres?)
- [ ] Music server: https://github.com/deluan/navidrome
- [ ] VSCode Server?
- [ ] Firefly III? (MySQL)
- [ ] Monica? (MySQL)
- [ ] SSO for Lynx/Discourse... just use Okta?

Self-host monitoring stack or just push it all to new relic?

## Goals
Describe all the services as docker-compose.yml, and basically have infrasturcture as code for everything - including ansible deployments - so that I can recreate all of this any time I'd like (and restore from backup more easily - just backup the volumes)

## Reference
https://github.com/DoTheEvo/selfhosted-apps-docker
