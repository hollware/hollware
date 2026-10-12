import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import { entries, revisions } from '../../src/schema.ts'
import { rejection } from './support.ts'

// Fails when: src/schema.ts changes a column, a type, a nullability or the foreign key without a
// regenerated migrations/0000_init.sql, or the migration stops being applied to the test database
// (vitest.config.ts reads the directory wrangler.jsonc points `migrations_dir` at).

describe('the drizzle-kit migrations, applied by the setup file', () => {
  it('were recorded in order, one row per file', async () => {
    const { results } = await env.DB.prepare('SELECT id, name FROM d1_migrations ORDER BY id').all()

    expect(results).toEqual([
      { id: 1, name: '0000_init.sql' },
      { id: 2, name: '0001_triggers.sql' },
    ])
  })

  it('created entries as drizzle declares it', async () => {
    const { results } = await env.DB.prepare('PRAGMA table_info(entries)').all()

    expect(results).toEqual([
      { cid: 0, name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'version', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'head_rev', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
    ])
  })

  it('created revisions as drizzle declares it, with its foreign key to entries', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(revisions)').all()
    const foreignKeys = await env.DB.prepare('PRAGMA foreign_key_list(revisions)').all()

    expect(columns.results).toEqual([
      { cid: 0, name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'entry_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'markdown', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 3, name: 'created_at', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    ])
    expect(foreignKeys.results).toEqual([
      {
        id: 0,
        seq: 0,
        table: 'entries',
        from: 'entry_id',
        to: 'id',
        on_update: 'NO ACTION',
        on_delete: 'NO ACTION',
        match: 'NONE',
      },
    ])
  })

  it('enforces the foreign key locally, like D1 does', async () => {
    const error = await rejection(() =>
      env.DB.prepare(
        'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind('rev_orphan', 'ent_missing', '# orphan', '2026-10-12T00:00:00Z')
        .run(),
    )

    expect(error.message).toBe(
      'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
    )
  })
})

describe('the drizzle schema against the migrated tables', () => {
  it('round-trips rows, mapping head_rev to headRev', async () => {
    const db = drizzle(env.DB)

    await db.insert(entries).values({ id: 'ent_a1', version: 1 })
    await db.insert(revisions).values({
      id: 'rev_a1',
      entryId: 'ent_a1',
      markdown: '# Hello',
      createdAt: '2026-10-12T10:00:00Z',
    })

    expect(await db.select().from(entries)).toEqual([{ id: 'ent_a1', version: 1, headRev: null }])
    expect(await db.select().from(revisions)).toEqual([
      { id: 'rev_a1', entryId: 'ent_a1', markdown: '# Hello', createdAt: '2026-10-12T10:00:00Z' },
    ])
  })
})
