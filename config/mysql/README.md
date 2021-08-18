MySQL instead of Postgres for easier operating experience (e.g. no need to "migrate" databases for updates)

Used by:

- bitwarden
- blink (TODO mysql support)
- blog (ghost): mysql/mariadb/sqlite3 only
- nextcloud
- photoprism: mysql/mariadb/sqlite3 only
- wiki (documize)

Ensure the database character set is set to utf8mb4 and collation is set to utf8mb4_bin!!
