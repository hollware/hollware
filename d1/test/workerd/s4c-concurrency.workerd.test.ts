import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import {
  writeRevision,
  writeRevisionRaw,
  type RevisionWrite,
  type WriteOutcome,
} from '../../src/optimistic-write.ts'
import { entryRow, revisionsOf, seedEntry } from './support.ts'

// Fails when: src/optimistic-write.ts stops deciding the conflict inside the database: the UPDATE
// loses its `version = ?` predicate (every racer bumps the version), the INSERT loses it (every
// racer adds a revision), or the two statements stop travelling in one batch (a racer's INSERT can
// then land between another racer's two statements). The control at the end fails when the local
// runtime stops interleaving requests between awaits: the racers above would then prove less than
// they claim.

type Writer = (write: RevisionWrite) => Promise<WriteOutcome>

const writers: [string, string, Writer][] = [
  ['drizzle db.batch', 'dz', (write) => writeRevision(drizzle(env.DB), write)],
  ['raw env.DB.batch', 'raw', (write) => writeRevisionRaw(env.DB, write)],
]

describe.each(writers)(
  'concurrent writes with the same expected version through %s',
  (_label, slug, write) => {
    // All racers are started before any is awaited: their batches are in flight together.
    const race = (entryId: string, racers: number) =>
      Promise.all(
        Array.from({ length: racers }, (_, index) =>
          write({
            entryId,
            expectedVersion: 1,
            revisionId: `rev_${slug}_${racers}_${index}`,
            markdown: `# Racer ${index}`,
            createdAt: '2026-10-12T10:00:00Z',
          }),
        ),
      )

    it('two racers: exactly one succeeds, the other gets an empty RETURNING, one revision is added', async () => {
      await seedEntry(`ent_race_${slug}_2`, 1)

      const outcomes = await race(`ent_race_${slug}_2`, 2)

      expect(outcomes.map((outcome) => outcome.outcome).toSorted()).toEqual(['conflict', 'written'])
      const winner = outcomes.findIndex((outcome) => outcome.outcome === 'written')
      expect(outcomes[winner]).toEqual({ outcome: 'written', version: 2 })
      expect(await revisionsOf(`ent_race_${slug}_2`)).toEqual([
        {
          id: `rev_${slug}_2_${winner}`,
          entry_id: `ent_race_${slug}_2`,
          markdown: `# Racer ${winner}`,
          created_at: '2026-10-12T10:00:00Z',
        },
      ])
      expect(await entryRow(`ent_race_${slug}_2`)).toEqual({
        id: `ent_race_${slug}_2`,
        version: 2,
        head_rev: `rev_${slug}_2_${winner}`,
      })
    })

    it('eight racers: still exactly one winner, seven conflicts, one revision, version bumped once', async () => {
      await seedEntry(`ent_race_${slug}_8`, 1)

      const outcomes = await race(`ent_race_${slug}_8`, 8)

      expect(outcomes.map((outcome) => outcome.outcome).toSorted()).toEqual([
        'conflict',
        'conflict',
        'conflict',
        'conflict',
        'conflict',
        'conflict',
        'conflict',
        'written',
      ])
      const winner = outcomes.findIndex((outcome) => outcome.outcome === 'written')
      expect(outcomes[winner]).toEqual({ outcome: 'written', version: 2 })
      expect((await revisionsOf(`ent_race_${slug}_8`)).map((row) => row.id)).toEqual([
        `rev_${slug}_8_${winner}`,
      ])
      expect(await entryRow(`ent_race_${slug}_8`)).toEqual({
        id: `ent_race_${slug}_8`,
        version: 2,
        head_rev: `rev_${slug}_8_${winner}`,
      })
    })
  },
)

// The control: the same two statements as separate calls instead of one batch. If the local
// runtime serialized whole requests, the tests above would pass for this too and prove nothing.
// It does not: all the INSERTs are queued before the first UPDATE can be sent, so every racer
// inserts a revision that never becomes the head.
async function writeRevisionWithoutBatch(write: RevisionWrite): Promise<WriteOutcome> {
  await env.DB.prepare(
    'INSERT INTO revisions (id, entry_id, markdown, created_at) ' +
      'SELECT ?, id, ?, ? FROM entries WHERE id = ? AND version = ?',
  )
    .bind(write.revisionId, write.markdown, write.createdAt, write.entryId, write.expectedVersion)
    .run()
  const { results } = await env.DB.prepare(
    'UPDATE entries SET version = version + 1, head_rev = ? ' +
      'WHERE id = ? AND version = ? RETURNING version',
  )
    .bind(write.revisionId, write.entryId, write.expectedVersion)
    .all<{ version: number }>()
  const [row] = results
  return row === undefined ? { outcome: 'conflict' } : { outcome: 'written', version: row.version }
}

describe('the control: two separate statements instead of one batch', () => {
  it('lets every one of eight racers insert a revision, although only one wins the version', async () => {
    await seedEntry('ent_race_no_batch', 1)

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        writeRevisionWithoutBatch({
          entryId: 'ent_race_no_batch',
          expectedVersion: 1,
          revisionId: `rev_no_batch_${index}`,
          markdown: `# Racer ${index}`,
          createdAt: '2026-10-12T10:00:00Z',
        }),
      ),
    )

    expect(outcomes.filter((outcome) => outcome.outcome === 'written')).toHaveLength(1)
    expect(await revisionsOf('ent_race_no_batch')).toHaveLength(8)
    expect((await entryRow('ent_race_no_batch'))?.version).toBe(2)
  })
})
