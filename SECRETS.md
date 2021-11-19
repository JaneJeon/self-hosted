For now, secrets are stored within gitignored files. They are:

- `.env`
- traefik.userfile (generated with `make init`)
- config/reverse-proxy/acme.json (generated with `make init` and populated automatically by traefik)
- authelia.userfile
