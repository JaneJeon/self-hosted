Portainer for managing containers on docker-compose

## LDAP Authentication

You can set up authentication with LDAP, so that users can authenticate with their LDAP credentials instead. You can follow the instructions here: https://github.com/nitnelave/lldap/blob/98acd68f060562f41a829e0e659a25029823069c/example_configs/portainer.md

A couple of notes:

- since the LLDAP instance is running on a different docker container, refer to it by its docker name (i.e. lldap:3890)
- the `dc=example,dc=com` should be replaced by the `ldap_base_dn` configuration in LLDAP (see config.toml)
- for the strangest reason, you're supposed to authenticate with the "base" LLDAP password (i.e. `LLDAP_LDAP_USER_PASS`) and not with any particular user's password

For best practices, limit the users that can authenticate into Portainer into a group (in LLDAP), and then let Portainer auto-create users of that group when they authenticate with their LDAP credentials (note that the group must already exist in Portainer for this to happen).

However, note that even with this, LDAP authentication with Portainer can be a bit of a pain in the ass, since in order to manage a pre-existing docker compose stack (as we are here), you need admin access, and the auto-generated user (at least in community edition) only has "base" permissions, meaning someone else must elevate that user (manually) to admin access to get access to the docker compose stack.
