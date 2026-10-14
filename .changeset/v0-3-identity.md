---
'@hollware/server': minor
'hollware': minor
---

Passkeys, invitations and sessions for the admin. The server adds migration `0004_identity.sql` and the `/setup` and `/signin` pages; the roles are now `owner`, `editor` and `author`. `hollware init` prints the owner's link to set up a passkey, and `hollware invite --role editor|author` invites a person.
