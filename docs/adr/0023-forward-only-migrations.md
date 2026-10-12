# ADR-023: Migrations only move forward, and a shipped migration never changes

Status: Accepted (2026-10-12)

## Context

`@hollware/server` ships its D1 migrations in `migrations/`, and users apply them to their own databases with `hollware migrate`, through `wrangler d1 migrations`. D1 records an applied migration by its file name. An edited file never runs again where it already ran, and runs differently where it had not, so two deployments of the same version would end up with different schemas.

Other facts that shape the decision:

- Releases 0.0.1 and 0.0.2 shipped `0000_init.sql`, the `_hollware_meta` table, before drizzle-kit came into the repository. drizzle-kit would start a `0000` of its own (review H7).
- drizzle-kit 0.31 generates SQL from the schema and from its snapshots in `migrations/meta`, and never reads a database. It does not model triggers. Some changes make it rebuild a table: it creates a `__new_` table, copies the rows, drops the old one and renames the new one. A rebuild drops the triggers of the table, and fails on foreign keys when other tables reference it, because `PRAGMA foreign_keys = OFF` is a no-op inside the transaction of a migration (spike S4).
- D1 migrations have no "down". A rollback is a restore, from Time Travel or from a `wrangler d1 export`.

## Decision

- Migrations only move forward. There are no down migrations, and a mistake in a shipped migration is fixed by a new one.
- A migration that a release of `@hollware/server` shipped is never edited or removed. The guard `shipped-migrations` compares every migration file that a `@hollware/server@*` tag holds with the working tree, byte for byte. CI checks out the full history with its tags, and a clone without the tags fails the guard instead of passing on nothing.
- `0000_init.sql` stays as shipped. drizzle-kit starts from a snapshot seeded from it, so its first generated migration is `0001`.
- `src/db/schema.ts` is the source of the schema, and `drizzle-kit generate --name <what>` writes the migration. A test runs `generate` on a copy of `migrations/` and fails if it would write anything.
- Hand-written migrations (`drizzle-kit generate --custom --name <what>`) cover what drizzle-kit does not model, such as triggers, and every rebuild. They open with a comment that says why. A rebuild of a table that has triggers creates them again in the same migration.
- Changes are additive whenever possible: a new table, a nullable column or one with a default, a new index. A change that makes drizzle-kit rebuild a table is avoided, or written by hand and tested on a copy of real data.
- `hollware migrate --check` lists the pending migrations, and `--remote` takes a backup with `wrangler d1 export` before it applies anything.

## Consequences

- Every deployment that applied the same migrations has the same schema, whatever release it came from.
- A mistake in a released migration stays in the history, and fixing it costs a new migration.
- A migration can be changed until a release ships it, and the guard protects it from the release tag on. Previews from pkg.pr.new carry unreleased migrations, so they are for trying a change, not for a database you keep.
- The schema anticipates the values the design already plans, such as `scheduled` in the status `CHECK`, so that a later stage does not force a rebuild (review M3).

## Alternatives considered

- A `migrations.lock.json` with the sha256 of every shipped migration, the first answer to review H7. Rejected: the lock lives in the same commit as the edit it should catch and can be updated with it. The release tags already record what shipped, and they cannot be moved or deleted.
- Down migrations. Rejected: D1 has none, and a down migration that drops data is worse than a restore.
- Letting drizzle-kit generate its own `0000`. Rejected: 0.0.1 and 0.0.2 shipped `0000_init.sql`, and D1 would find a different file under the same name.
- `drizzle-kit push` or `drizzle-kit migrate` against the database. Rejected: users apply migrations with Wrangler, the files are what ships, and `push` keeps no history.
