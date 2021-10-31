For now, secrets are stored within gitignored files. They are:

- `.env`
- `.server.env`
- traefik.userfile (generated with `make init`)
- config/reverse-proxy/acme.json (generated with `make init` and populated automatically by traefik)
