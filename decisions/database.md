The choice of database, to use MySQL or Postgres

They're both _basically_ the same nowadays, the only factor is which ones the applications I'm using support it.

So far the only ones that DON'T support both are:

- ~~matomo (MySQL only, but could be easily replaced)~~
- ghost (MySQL only, cannot be easily replaced but could go with sqlite3)
- ~~comments? (PostgreSQL only, cannot be easily replaced but could go with sqlite3; plus, I could end up writing my own)~~
- ~~Blink (PostgreSQL only, but MySQL support on the works - sort of)~~
- Photoprism (MySQL only, cannot be easily replaced but could go with sqlite3)
- Invidious? (Postgres only, but looks like they're looking into making it available w/o Postgres)

Generally, PHP applications prefer MySQL, and the "new-age" applications prefer Postgres. So the question is, do we host both, or try to decide which ones are more important?

Individious _is_ important, but otherwise I can basically ignore Postgres and its higher operational burden (e.g. major version upgrades).
