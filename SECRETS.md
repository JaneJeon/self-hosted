For now, secrets are stored within gitignored files. They are:

- .env (`mail__options__auth__pass`, `CLOUDFLARE_DNS_API_TOKEN`, `CLOUDFLARE_ZONE_API_TOKEN`)
- traefik.userfile (generated with `make init`)
- config/reverse-proxy/acme.json (generated with `make init` and populated automatically by traefik)
- .server.env (only contains `REMOTE_IP` of the remote box)
