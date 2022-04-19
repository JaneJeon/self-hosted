I know "adblock DNS"s exist, but set up my own to have greater control over the traffic, what gets blocked, clients, etc.

The current setup uses DNS-over-HTTPS, and apparently that means:

- AGH won't actually listen to the HTTPS port (443)
- and instead it only listens to 3000 (web) and 53 (default DNS)
- and the DoH is actually served on the same "site" as the web dashboard, except with the `/dns-query` at the end!

Thus, both the web dashboard and the DoH is being served at the adguard subdomain...
