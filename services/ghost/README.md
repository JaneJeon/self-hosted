# Ghost CMS

`config.json` supplies the shared application settings. Railway runtime
variables supply the public URL, MySQL connection, and SMTP credentials.
Keep `database__connection__password` as a reference to
`MySQL.GHOST_MYSQL_PASSWORD`.

When rotating the database password, update the existing MySQL account and
restart this consumer through a service-scoped GitOps deployment. Verify the
public site and a fresh database connection before discarding the old password.
The MySQL README owns the dual-password cutover procedure.

Admin device verification depends on transactional email. Verify SMTP delivery
separately from the public site's health. The open incident and admin-access
decision live in the Craft [Railway env var breach response Index](https://docs.craft.do/editor/d/53687cd7-874b-cff7-84ed-3a082a04cb77/5f8e4e12-cd52-bc9b-0454-3368f2cb8484).
