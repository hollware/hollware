---
'create-hollware': patch
---

A project's own test of its database no longer breaks when Hollware adds a migration: it checks that every migration of `@hollware/server` is applied and that the tables of content are there, instead of listing every table of one release.
