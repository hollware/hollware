import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { revisionsOf, seedEntry, seedRevision, triggerNames } from './support.ts'

// Fails when: test/fixtures/evolution/recreate stops being what drizzle-kit generates for a
// changed column default on `revisions` (CREATE __new_revisions, INSERT SELECT, DROP TABLE,
// RENAME), or SQLite/D1 stops dropping the triggers of a dropped table. The first one is the
// signal to stop trusting this test's conclusion; the second would retire the guard in
// s4d-triggers.workerd.test.ts ("are all there once every migration has been applied").

const ORIGINAL = {
  id: 'rev_recreate',
  entry_id: 'ent_recreate',
  markdown: '# Original',
  created_at: '2026-10-12T10:00:00Z',
}

describe('after a drizzle-kit migration that rebuilds revisions', () => {
  beforeAll(async () => {
    await seedEntry(ORIGINAL.entry_id, 1)
    await seedRevision(ORIGINAL)
    await applyD1Migrations(env.DB, env.RECREATE_MIGRATIONS)
  })

  it('is the table rebuild drizzle-kit generates', () => {
    const [migration] = env.RECREATE_MIGRATIONS

    expect(env.RECREATE_MIGRATIONS).toHaveLength(1)
    expect(migration?.name).toBe('0002_created_at_default.sql')
    expect(
      migration?.queries.some((query) => query.includes('CREATE TABLE `__new_revisions`')),
    ).toBe(true)
    expect(migration?.queries.some((query) => query.includes('DROP TABLE `revisions`'))).toBe(true)
  })

  it('has no triggers left: DROP TABLE took them along and drizzle-kit never re-created them', async () => {
    expect(await triggerNames()).toEqual([])
  })

  it('kept the rows', async () => {
    expect(await revisionsOf(ORIGINAL.entry_id)).toEqual([ORIGINAL])
  })

  it('no longer protects the rows: they can be rewritten and deleted', async () => {
    await env.DB.prepare('UPDATE revisions SET markdown = ? WHERE id = ?')
      .bind('# Tampered', ORIGINAL.id)
      .run()
    const tampered = await revisionsOf(ORIGINAL.entry_id)
    await env.DB.prepare('DELETE FROM revisions WHERE id = ?').bind(ORIGINAL.id).run()

    expect(tampered).toEqual([{ ...ORIGINAL, markdown: '# Tampered' }])
    expect(await revisionsOf(ORIGINAL.entry_id)).toEqual([])
  })
})
