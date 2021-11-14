Gate infrastructure pieces behind SSO; this does not serve as authZ from controlling which credentials a user should have for a database (that is for Vault), but rather to _connect_ the user and the remote resource (so that, for example, you can directly connect to databases within a box without having to SSH first - you'd still need a valid credential to use it).

Go with Pomerium for the ability to act "essentially" as a VPN and to both act as an SSO proxy for the web applications and also act as a VPN tunnel for SSH/databases (so unlike Teleport, you'd be able to connect using GUIs)!
