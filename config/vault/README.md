For storing secrets

Is all self-referencing connection bad? e.g. Using MySQL as storage backend

When a secret _that Vault relies on_ is directly or indirectly stored in vault, what happens when we lose Vault?

For example, if we lose Vault and the backup encryption key is stored in Vault, and we lose the server... how will we restore from backup without the key to decrypt it with? I'm sure we can _physically_ restore the backup files from B2 to local disk, but then what? Without decryption, the backup is not meaningful. So the backup key has to be stored in a password manager and passed via an .env file or some shit.

So suppose it's stored in a password manager. The password manager ultimately stores all its data in a DB. The DB's backup is encrypted via the secret key stored the password manager. What happens when we lose the DB? We can restore the backup of the DB into local disk, but then how do we decrypt it? As in, where will we get the decryption key?

Obviously, whatever we used to originally supply the decryption key to the backup service is gone, so we need to find another copy: in the password manager! But before you use the password manager, you must restore the database. But because the backup is encrypted, you cannot restore the database, and thus, the password manager.

So the _backup encryption key_ should NOT be stored in Vault (even indirectly). What about others?

Is it safe to store the master unseal key in the password manager?

Are all the concerns gone if we don't encrypt our backups? I think so, because as long as we can restore the DB (but wait, how will we login)

Conclusion: you need to store the "master" key that controls the infrastructure (e.g. backups, secrets management) OFF the system, hence the need for something like AWS Secrets Management. But Vultr doesn't have such a thing.

So the only remedies are to either go for a high availability Vault setup to make sure it doesn't fail, OR, keep a copy in your head or something.

Solution: rely on bitwarden local apps retaining their local secret values
