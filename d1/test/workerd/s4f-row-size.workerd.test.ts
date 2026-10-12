import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import { writeRevision } from '../../src/optimistic-write.ts'
import { entryRow, rejection, revisionsOf, seedEntry } from './support.ts'

// Fails when: src/optimistic-write.ts stops binding the markdown as a parameter (inlined into the
// SQL text it would hit the 100,000-byte statement limit long before 1.9 MB), or stops sending
// the INSERT and the UPDATE in one batch (a rejected INSERT would then leave the version bumped).
// The rest documents what the local runtime does with sizes: if workerd starts enforcing D1's
// 2 MB limit, the "does not enforce" tests fail and the plan can test `size-limit` against D1.

async function insertRevision(id: string, markdown: string, createdAt = '2026-10-12T10:00:00Z') {
  await seedEntry(`ent_${id}`, 1)
  return env.DB.prepare(
    'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, `ent_${id}`, markdown, createdAt)
    .run()
}

async function storedSize(id: string) {
  return env.DB.prepare(
    'SELECT length(markdown) AS chars, length(CAST(markdown AS BLOB)) AS bytes FROM revisions WHERE id = ?',
  )
    .bind(id)
    .first()
}

describe('a revision just under the 2 MB limit', () => {
  it('inserts with a 1.9 MB TEXT column and reads back whole', async () => {
    const result = await insertRevision('rev_size_ascii', 'a'.repeat(1_900_000))

    expect(result.meta.changes).toBe(1)
    expect(await storedSize('rev_size_ascii')).toEqual({ chars: 1_900_000, bytes: 1_900_000 })
  })

  it('counts bytes, not characters: 950,000 two-byte characters are 1.9 MB too', async () => {
    await insertRevision('rev_size_utf8', 'é'.repeat(950_000))

    expect(await storedSize('rev_size_utf8')).toEqual({ chars: 950_000, bytes: 1_900_000 })
  })

  it('goes through the optimistic write: INSERT...SELECT binds the 1.9 MB as one parameter', async () => {
    const db = drizzle(env.DB)
    await seedEntry('ent_size_write', 1)

    const outcome = await writeRevision(db, {
      entryId: 'ent_size_write',
      expectedVersion: 1,
      revisionId: 'rev_size_write',
      markdown: 'a'.repeat(1_900_000),
      createdAt: '2026-10-12T10:00:00Z',
    })

    expect(outcome).toEqual({ outcome: 'written', version: 2 })
    expect(await storedSize('rev_size_write')).toEqual({ chars: 1_900_000, bytes: 1_900_000 })
  })
})

describe('just above D1 production limit of 2,000,000 bytes, the local runtime', () => {
  it.each([2_000_001, 2_097_153, 3_000_000])(
    'does not enforce it: %i bytes insert',
    async (bytes) => {
      await insertRevision(`rev_size_over_${bytes}`, 'a'.repeat(bytes))

      expect(await storedSize(`rev_size_over_${bytes}`)).toEqual({ chars: bytes, bytes })
    },
  )
})

describe('the ceiling the local runtime does enforce', () => {
  const TOO_BIG = 'D1_ERROR: string or blob too big: SQLITE_TOOBIG'

  it('is a row of about 8 MiB: 4 MB + 4 MB inserts, 5 MB + 5 MB is rejected', async () => {
    await insertRevision('rev_size_row_ok', 'a'.repeat(4_000_000), 'b'.repeat(4_000_000))
    const error = await rejection(() =>
      insertRevision('rev_size_row_big', 'a'.repeat(5_000_000), 'b'.repeat(5_000_000)),
    )

    expect(await storedSize('rev_size_row_ok')).toEqual({ chars: 4_000_000, bytes: 4_000_000 })
    expect(error.message).toBe(TOO_BIG)
    expect(await storedSize('rev_size_row_big')).toBeNull()
  })

  it('rejects a single 9 MB value with SQLITE_TOOBIG', async () => {
    const error = await rejection(() => insertRevision('rev_size_9mb', 'a'.repeat(9_000_000)))

    expect(error.name).toBe('Error')
    expect(error.message).toBe(TOO_BIG)
    expect(error.cause instanceof Error && error.cause.message).toBe(
      'string or blob too big: SQLITE_TOOBIG',
    )
    expect(await storedSize('rev_size_9mb')).toBeNull()
  })

  it('rolls the whole optimistic write back: no revision, and the version is not bumped', async () => {
    const db = drizzle(env.DB)
    await seedEntry('ent_size_rollback', 1)

    const error = await rejection(() =>
      writeRevision(db, {
        entryId: 'ent_size_rollback',
        expectedVersion: 1,
        revisionId: 'rev_size_rollback',
        markdown: 'a'.repeat(9_000_000),
        createdAt: '2026-10-12T10:00:00Z',
      }),
    )

    expect(error.message).toBe(TOO_BIG)
    expect(await revisionsOf('ent_size_rollback')).toEqual([])
    expect(await entryRow('ent_size_rollback')).toEqual({
      id: 'ent_size_rollback',
      version: 1,
      head_rev: null,
    })
  })
})

describe('other D1 limits the local runtime enforces like production', () => {
  const placeholders = (count: number) =>
    `SELECT ${Array.from({ length: count }, (_, index) => `?${index + 1} AS c${index}`).join(', ')}`
  const values = (count: number) => Array.from({ length: count }, (_, index) => index)

  it('allows 100 bound parameters', async () => {
    const { results } = await env.DB.prepare(placeholders(100))
      .bind(...values(100))
      .all()

    expect(Object.keys(results[0] ?? {})).toHaveLength(100)
  })

  it('rejects 101 bound parameters', async () => {
    const error = await rejection(() =>
      env.DB.prepare(placeholders(101))
        .bind(...values(101))
        .all(),
    )

    expect(error.message).toMatch(
      /^D1_ERROR: variable number must be between \?1 and \?100 at offset \d+: SQLITE_ERROR$/,
    )
  })

  it('allows a 99,000-byte statement and rejects a 101,000-byte one: bind markdown, never inline it', async () => {
    const small = await env.DB.prepare(`SELECT '${'a'.repeat(99_000)}' AS s`).first<{ s: string }>()
    const error = await rejection(() =>
      env.DB.prepare(`SELECT '${'a'.repeat(101_000)}' AS s`).first(),
    )

    expect(small?.s.length).toBe(99_000)
    expect(error.message).toBe('D1_ERROR: statement too long: SQLITE_TOOBIG')
  })
})
