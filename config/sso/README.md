For now, https://github.com/nitnelave/lldap only supports readonly LDAP protocols; however, over time I would expect it to replace Authelia's file-based user "directory".

As for why not just use Authelia + userfiles, I want to directly authenticate w/ applications that support it (e.g. Portainer).

And I think this is really the "best" LDAP implementation out there because of how it is laser focused on simplicity and doesn't try to do everything (e.g. it offloads password resets/2FA to Authelia). The only thing it would need baked-in is user management.
