---
'@hollware/server': minor
---

The owners of a site manage its people from the admin: `POST /v1/admin/people/role` gives a member another role, and `POST /v1/admin/people/remove` takes one out of the site, whose tokens and grants of it stop working at once. A site always keeps one owner: the statement that would demote or remove its last one changes nothing (409 `conflict`). A refusal of the admin's routes now carries `not_found` for 404 and `conflict` for 409.
