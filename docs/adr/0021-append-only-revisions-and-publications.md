# ADR-021: Revisions, their tags and publications are append-only; child rows are written only with their revision

Status: Accepted (2026-10-12)

## Context

The history of an entry is its revisions. The export has to reproduce any revision byte for byte ([ADR-001](0001-markdown-is-the-source-of-truth.md)), a change made by an agent must never overwrite the one before it, and a publish has to say which revision went live, with which verdict and which acknowledged warnings. D1 holds all of it ([ADR-002](0002-d1-is-the-single-source-of-truth.md)).

Writes are optimistic. One `db.batch` inserts the revision with `INSERT … SELECT … WHERE version = ?` and then updates the entry with `UPDATE … WHERE version = ? RETURNING version`. D1 runs a batch as one transaction and offers no `db.transaction()`, so a stale write inserts nothing (spike S4).

What the spikes and the review of the v0.1 plan found:

- A child row of the revision, such as a tag, inserted unconditionally in that batch would point at a revision that a stale write never inserted. The foreign key then fails, and a `conflict` turns into a database error (review H6).
- SQLite's `INSERT OR REPLACE` deletes the row it replaces without firing `DELETE` triggers, because `recursive_triggers` is off. A trigger on `DELETE` alone does not keep a row (spike S4).
- The reparse of the cron (`server/src/derived/reparse.ts`) rebuilds the derived document when Comark or the pipeline changes ([ADR-020](0020-content-safety-is-a-contract.md)), so some columns of a revision must stay writable.
- The warnings a caller acknowledged to publish had nowhere to live (review M2).
- drizzle-kit does not model triggers. `generate` never drops them, but a migration that rebuilds a table drops them with it.

## Decision

- `revisions`, `revision_tags` and `publications` are append-only, and the database enforces it with three triggers per table (migration `0002_append_only.sql`):
  - `_no_delete`: a row is never deleted.
  - `_immutable`: an `UPDATE` of any column but the derived ones aborts. The derived columns are `frontmatter`, `document`, `comark_version`, `pipeline_version` and `word_count` of a revision, and `updated_at` of every row.
  - `_no_replace`: an `INSERT` whose unique key is taken aborts. It checks every unique key of the table, so `INSERT OR REPLACE` cannot delete a row around `_no_delete`.

  Every message starts with `append-only:`, and the repository code matches that prefix.

- `revisions.markdown` holds the whole file, frontmatter included, and never changes.
- An entry points at its head and published revisions (`head_rev`, `published_rev`) without a foreign key. Entries and revisions would reference each other, and D1 does not defer foreign keys, so it could not insert the pair. The repository writes both in one batch.
- The child rows of a revision, such as its tags, are inserted in the same batch and only `WHERE EXISTS` their revision. A stale write inserts nothing at all and is reported as `conflict`.
- Every publish and unpublish appends a `publications` row: the revision, the verdict of the publish phase, the warnings the caller acknowledged and the actor. The entry's `published_rev` says what is live, and `publications` says how it got there.
- A migration that rebuilds one of these tables creates its triggers again. A test lists the nine triggers after all migrations and tries every column and every unique key of the three tables.

## Consequences

- Neither an operation, nor a bug in the repository, nor `INSERT OR REPLACE` can lose or rewrite history. Restoring an old version (v0.2) appends a new revision.
- These tables only grow, so the size of a deployment is the sum of its revisions. Erasing content for good (a site, an entry, the data of a person) needs a procedure of its own, at the level of migrations, that a later ADR defines.
- A new column of these tables has to be classified. Either it is immutable, and a migration recreates the `_immutable` trigger with it, or it is derived. A new unique key has to be added to `_no_replace`. The tests fail until it is.
- `INSERT OR IGNORE` and `ON CONFLICT DO NOTHING` abort on these tables too, because the trigger runs first. An idempotent write looks for the row instead.
- Adding a nullable column with drizzle-kit is one `ALTER TABLE … ADD` and keeps the triggers. A change that makes drizzle-kit rebuild one of these tables is a hand-written migration ([ADR-023](0023-forward-only-migrations.md)).

## Alternatives considered

- Enforcing append-only in the repository code only. Rejected: one wrong query, or a future operation, would rewrite history, and the database guard costs three triggers per table.
- Two triggers per table, on `DELETE` and on `UPDATE`. Rejected: `INSERT OR REPLACE` deletes the old row without firing the `DELETE` trigger (spike S4).
- A foreign key from entries to their revisions. Rejected: D1 cannot insert the cycle, because it does not defer foreign keys.
- Inserting child rows unconditionally and reading the foreign key error as the conflict. Rejected: a conflict would surface as a database error, and the outcome would depend on whether the revision had tags.
- Recording the acknowledged warnings on the revision or on the entry. Rejected: they belong to one publish, and an entry is published many times.
