Gate infrastructure pieces behind SSO; this does not serve as authZ from controlling which credentials a user should have for a database (that is for Vault), but rather to _connect_ the user and the remote resource (so that, for example, you can directly connect to databases within a box without having to SSH first - you'd still need a valid credential to use it).

Go with Teleport for infra access
