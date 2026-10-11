# @hollware/server

The Hollware Worker. Boundary rules for this package:

- It owns the D1 migrations in `migrations/` and ships them (`files` in `package.json`).
- A shipped migration is never edited: fix forward with a new migration.
- Never read `process.env`: configuration and bindings arrive as arguments.
