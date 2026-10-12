import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { describe, expect, it } from 'vitest'
import { revisions } from '../../src/schema.ts'
import {
  revisionsOf,
  rejection,
  rootMessage,
  seedEntry,
  seedRevision,
  triggerNames,
  type RevisionRow,
} from './support.ts'

// Fails when: migrations/0001_triggers.sql drops or weakens a trigger (the DELETE one, the one
// on UPDATE OF id/entry_id/markdown/created_at, the BEFORE INSERT one), or a later migration
// removes them (see s4d-recreate-migration.workerd.test.ts for how drizzle-kit does that).

const SQLITE_SUFFIX = ': SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)'
const DELETE_TEXT = `revisions are append-only: DELETE is not allowed${SQLITE_SUFFIX}`
const UPDATE_TEXT = `revisions are append-only: id, entry_id, markdown and created_at are immutable${SQLITE_SUFFIX}`
const REPLACE_TEXT = `revisions are append-only: a revision with this id already exists${SQLITE_SUFFIX}`

/** An entry with one revision, under ids no other test uses. */
async function seedPair(name: string): Promise<RevisionRow> {
  const row: RevisionRow = {
    id: `rev_${name}`,
    entry_id: `ent_${name}`,
    markdown: '# Original',
    created_at: '2026-10-12T10:00:00Z',
  }
  await seedEntry(row.entry_id, 1)
  await seedRevision(row)
  return row
}

describe('the triggers of migrations/0001_triggers.sql', () => {
  it('are all there once every migration has been applied', async () => {
    expect(await triggerNames()).toEqual([
      'revisions_immutable_columns',
      'revisions_no_delete',
      'revisions_no_replace',
    ])
  })
})

describe('DELETE FROM revisions', () => {
  it('aborts with the trigger message through env.DB.prepare().run(), and the row is intact', async () => {
    const row = await seedPair('delete_run')

    const error = await rejection(() =>
      env.DB.prepare('DELETE FROM revisions WHERE id = ?').bind(row.id).run(),
    )

    expect(error.name).toBe('Error')
    expect(error.message).toBe(`D1_ERROR: ${DELETE_TEXT}`)
    expect(rootMessage(error)).toBe(DELETE_TEXT)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('aborts with the same message inside env.DB.batch', async () => {
    const row = await seedPair('delete_batch')

    const error = await rejection(() =>
      env.DB.batch([env.DB.prepare('DELETE FROM revisions WHERE id = ?').bind(row.id)]),
    )

    expect(error.message).toBe(`D1_ERROR: ${DELETE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('aborts inside drizzle db.batch with the unwrapped D1 error', async () => {
    const db = drizzle(env.DB)
    const row = await seedPair('delete_dz_batch')

    const error = await rejection(() =>
      db.batch([db.delete(revisions).where(eq(revisions.id, row.id))]),
    )

    expect(error).not.toBeInstanceOf(DrizzleQueryError)
    expect(error.message).toBe(`D1_ERROR: ${DELETE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('aborts as a DrizzleQueryError when drizzle runs the statement alone: the D1 error is its cause', async () => {
    const db = drizzle(env.DB)
    const row = await seedPair('delete_dz_single')

    const error = await rejection(() => db.delete(revisions).where(eq(revisions.id, row.id)))

    expect(error).toBeInstanceOf(DrizzleQueryError)
    expect(error.message).toBe(
      'Failed query: delete from "revisions" where "revisions"."id" = ?\nparams: rev_delete_dz_single',
    )
    expect(error.cause instanceof Error && error.cause.message).toBe(`D1_ERROR: ${DELETE_TEXT}`)
    expect(rootMessage(error)).toBe(DELETE_TEXT)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })
})

describe('UPDATE of an immutable column of revisions', () => {
  it.each(['id', 'entry_id', 'markdown', 'created_at'])(
    'aborts when %s is in the SET list, even if the value would not change',
    async (column) => {
      const row = await seedPair(`update_${column}`)

      const error = await rejection(() =>
        env.DB.prepare(`UPDATE revisions SET ${column} = ${column} WHERE id = ?`)
          .bind(row.id)
          .run(),
      )

      expect(error.message).toBe(`D1_ERROR: ${UPDATE_TEXT}`)
      expect(await revisionsOf(row.entry_id)).toEqual([row])
    },
  )

  it('aborts through drizzle, with the query in the message and the trigger text at the end of the cause chain', async () => {
    const db = drizzle(env.DB)
    const row = await seedPair('update_dz')

    const error = await rejection(() =>
      db.update(revisions).set({ markdown: '# Tampered' }).where(eq(revisions.id, row.id)),
    )

    expect(error.message).toBe(
      'Failed query: update "revisions" set "markdown" = ? where "revisions"."id" = ?\nparams: # Tampered,rev_update_dz',
    )
    expect(rootMessage(error)).toBe(UPDATE_TEXT)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('aborts an upsert (INSERT ... ON CONFLICT DO UPDATE) on a taken id', async () => {
    const row = await seedPair('upsert')

    const error = await rejection(() =>
      env.DB.prepare(
        'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown',
      )
        .bind(row.id, row.entry_id, '# Upserted', '2026-10-13T00:00:00Z')
        .run(),
    )

    // revisions_no_replace fires first: BEFORE INSERT runs before the conflict is found.
    expect(error.message).toBe(`D1_ERROR: ${REPLACE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })
})

describe('INSERT of a revision whose id is taken', () => {
  it('aborts a plain INSERT with the trigger text, not with the PRIMARY KEY error', async () => {
    const row = await seedPair('dup_plain')

    const error = await rejection(() =>
      env.DB.prepare(
        'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(row.id, row.entry_id, '# Second', '2026-10-13T00:00:00Z')
        .run(),
    )

    expect(error.message).toBe(`D1_ERROR: ${REPLACE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('aborts INSERT OR REPLACE, which would otherwise overwrite the row', async () => {
    const row = await seedPair('replace')

    const error = await rejection(() =>
      env.DB.prepare(
        'INSERT OR REPLACE INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(row.id, row.entry_id, '# Replaced', '2026-10-13T00:00:00Z')
        .run(),
    )

    expect(error.message).toBe(`D1_ERROR: ${REPLACE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })

  it('is the only thing stopping REPLACE: with recursive_triggers off, the DELETE trigger never fires for it', async () => {
    const row = await seedPair('replace_hole')
    const upsert = () =>
      env.DB.prepare(
        'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET markdown = excluded.markdown',
      )
        .bind(row.id, row.entry_id, '# Upserted', '2026-10-13T00:00:00Z')
        .run()
    const recursive = await env.DB.prepare('PRAGMA recursive_triggers').all()
    const trigger = await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'revisions_no_replace'",
    ).first<{ sql: string }>()
    if (trigger === null) throw new Error('revisions_no_replace is missing')

    await env.DB.prepare('DROP TRIGGER revisions_no_replace').run()
    try {
      // The upsert is still stopped: its DO UPDATE is an UPDATE of an immutable column.
      expect((await rejection(upsert)).message).toBe(`D1_ERROR: ${UPDATE_TEXT}`)
      // REPLACE is not: it deletes the old row without firing the DELETE trigger.
      await env.DB.prepare(
        'INSERT OR REPLACE INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(row.id, row.entry_id, '# Replaced', '2026-10-13T00:00:00Z')
        .run()

      expect(recursive.results).toEqual([{ recursive_triggers: 0 }])
      expect(await revisionsOf(row.entry_id)).toEqual([
        {
          id: row.id,
          entry_id: row.entry_id,
          markdown: '# Replaced',
          created_at: '2026-10-13T00:00:00Z',
        },
      ])
    } finally {
      await env.DB.prepare(trigger.sql).run()
    }
    expect(await triggerNames()).toEqual([
      'revisions_immutable_columns',
      'revisions_no_delete',
      'revisions_no_replace',
    ])
  })
})

describe('a trigger abort inside a batch', () => {
  it('rolls back the statements that ran before it', async () => {
    const row = await seedPair('rollback')
    const insert = env.DB.prepare(
      'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
    )

    const error = await rejection(() =>
      env.DB.batch([
        insert.bind('rev_rollback_new', row.entry_id, '# New', '2026-10-13T00:00:00Z'),
        env.DB.prepare('DELETE FROM revisions WHERE id = ?').bind(row.id),
      ]),
    )

    expect(error.message).toBe(`D1_ERROR: ${DELETE_TEXT}`)
    expect(await revisionsOf(row.entry_id)).toEqual([row])
  })
})
