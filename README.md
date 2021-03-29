## Applications to self-host
### "Serverless"/managed
- [ ] Blog (Forestry/Vercel/git JAMStack!)
- [ ] Auth0 SSO for Blink

### Public Facing Applications
- [ ] Analytics for blog: https://github.com/mikecao/umami (MySQL | Postgres)
- [ ] Remark42 (GitHub integration, no DB, >1 bus factor)

Specifically for Lynx, how to abuse cloud free tiers?
AWS provides EC2/RDS/Redis for free for a year, GCP gives you cloud run/object storage/compute engine/app engine/bigquery for free, Oracle gives you 2 VMs (w/ beefy block storage) and object storage for free.

Other than Lynx itself, the whole CDN logs -> ingest into a serverless analytics DB -> serverless data warehouse thing is going to be a pain in the ass, especially since standard tools (such as apache airflow) are expensive as hell on AWS...

### Private Applications
- [ ] Music server: https://github.com/deluan/navidrome
- [ ] VSCode Server?
- [ ] Monica? (MySQL)

Self-host monitoring stack or just push it all to new relic?

## Goals
Describe all the services as docker-compose.yml, and basically have infrasturcture as code for everything - including ansible deployments - so that I can recreate all of this any time I'd like (and restore from backup more easily - just backup the volumes)

## Reference
https://github.com/DoTheEvo/selfhosted-apps-docker
https://github.com/docker/awesome-compose
