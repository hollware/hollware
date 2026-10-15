---
'@hollware/server': minor
'hollware': minor
---

Passkeys, invitations and sessions for the admin. The server adds migration `0004_identity.sql` and the `/setup` and `/signin` pages; a person's role in a site is their row of the new `members` table, `owner`, `editor` or `author` (every person with a token becomes a member of its site, a `reviewer` of v0.2 an `author`). `hollware init` prints the owner's link to set up a passkey, and `hollware invite --role editor|author` invites a person.
