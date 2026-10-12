import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { rejection, revisionsOf, seedEntry, seedRevision, triggerNames } from './support.ts'

// Fails when: test/fixtures/evolution/additive stops being what drizzle-kit generates for a new
// nullable `word_count` column (an ALTER TABLE ADD, no rebuild), or the trigger on
// UPDATE OF id/entry_id/markdown/created_at starts blocking a column outside its list.

describe('after a drizzle-kit migration that only adds a nullable derived column', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.ADDITIVE_MIGRATIONS)
  })

  it('is a single ALTER TABLE ADD, as drizzle-kit generated it', () => {
    expect(env.ADDITIVE_MIGRATIONS).toEqual([
      {
        name: '0002_derived_word_count.sql',
        queries: ['ALTER TABLE `revisions` ADD `word_count` integer;'],
      },
    ])
  })

  it('has the new column and keeps all three triggers', async () => {
    const columns = await env.DB.prepare('PRAGMA table_info(revisions)').all()

    expect(columns.results.at(-1)).toEqual({
      cid: 4,
      name: 'word_count',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 0,
    })
    expect(await triggerNames()).toEqual([
      'revisions_immutable_columns',
      'revisions_no_delete',
      'revisions_no_replace',
    ])
  })

  it('lets the derived column change while the immutable columns stay blocked', async () => {
    await seedEntry('ent_additive', 1)
    await seedRevision({
      id: 'rev_additive',
      entry_id: 'ent_additive',
      markdown: '# Original',
      created_at: '2026-10-12T10:00:00Z',
    })

    await env.DB.prepare('UPDATE revisions SET word_count = 3 WHERE id = ?')
      .bind('rev_additive')
      .run()
    const blocked = await rejection(() =>
      env.DB.prepare('UPDATE revisions SET markdown = ?, word_count = 4 WHERE id = ?')
        .bind('# Tampered', 'rev_additive')
        .run(),
    )

    expect(blocked.message).toBe(
      'D1_ERROR: revisions are append-only: id, entry_id, markdown and created_at are immutable: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
    )
    expect(await revisionsOf('ent_additive')).toEqual([
      {
        id: 'rev_additive',
        entry_id: 'ent_additive',
        markdown: '# Original',
        created_at: '2026-10-12T10:00:00Z',
      },
    ])
    expect(
      await env.DB.prepare('SELECT word_count FROM revisions WHERE id = ?')
        .bind('rev_additive')
        .first(),
    ).toEqual({ word_count: 3 })
  })
})
