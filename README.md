## Prerequisites

Cloudflare account, domains, API token

## Deploy process

For now, I'll deploy from my local computer - I just don't trust myself to properly set up a CI to not leak credentials and fuck up production systems!

- (not yet implemented) run terraform to apply anything, generate secrets and dump them into gitignored files
- run `make deploy` to rsync this entire goddamn folder to the VPS over SSH or something (requires me to setup rsync first, or just scp or whatever it's called)
- run `make up` to reload all the goddamn things (note that docker-compose only reloads containers that have changed - either image or the actual docker-compose config)

## Creating a new service

Checklist for web-facing services:

- [ ] Traefik labels (incl. entrypoint)
- [ ] Watchtower label(s)
- [ ] Authelia middleware label
- [ ] Flame label
- [ ] Restart policy
- [ ] Networks

Checklist for internal services:

- [ ] Watchtower label(s)
- [ ] Restart policy
- [ ] Networks
