Traefik's cert implementation fucking _suuuuuuuuuucks_ - no way to configure cert lifecycle, rate limits, retries, etc.

Properly generate certs with some other tool and just mount it onto traefik!

NOTE: after certs are generated, run `sudo chmod -R 755 volumes/certs`!
