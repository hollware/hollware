import { env } from 'cloudflare:workers'
import { entries, revisions } from '../../src/schema.ts'
import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  revisionWriteStatements,
  writeRevision,
  writeRevisionRaw,
  type RevisionWrite,
  type WriteOutcome,
} from '../../src/optimistic-write.ts'
import { entryRow, rejection, revisionsOf, rootMessage, seedEntry } from './support.ts'

// Fails when: src/optimistic-write.ts drops `version = ?` from the INSERT...SELECT or from the
// UPDATE, runs the UPDATE before the INSERT, drops RETURNING (or stops reading it as the conflict
// signal), or sends the two statements in separate calls instead of one batch.

type Writer = (write: RevisionWrite) => Promise<WriteOutcome>

/** A D1Database that records every SQL text handed to prepare(), then forwards to `target`. */
function recordingDatabase(target: D1Database, prepared: string[]): D1Database {
  return {
    prepare: (query) => {
      prepared.push(query)
      return target.prepare(query)
    },
    batch: <T = unknown>(statements: D1PreparedStatement[]) => target.batch<T>(statements),
    exec: (query) => target.exec(query),
    withSession: (constraintOrBookmark) => target.withSession(constraintOrBookmark),
    dump: () => target.dump(),
  }
}

const writers: [string, string, Writer][] = [
  ['drizzle db.batch', 'dz', (write) => writeRevision(drizzle(env.DB), write)],
  ['raw env.DB.batch', 'raw', (write) => writeRevisionRaw(env.DB, write)],
]

describe.each(writers)('the optimistic write through %s', (_label, slug, write) => {
  // revisions.id is the primary key of the whole table, so each writer gets its own ids.
  const input = (entryId: string, expectedVersion: number, name: string): RevisionWrite => ({
    entryId,
    expectedVersion,
    revisionId: `rev_${slug}_${name}`,
    markdown: `# Draft ${name}`,
    createdAt: '2026-10-12T10:00:00Z',
  })

  it('with the current version inserts one revision and returns the new version', async () => {
    await seedEntry(`ent_current_${slug}`, 1)

    const outcome = await write(input(`ent_current_${slug}`, 1, 'one'))

    expect(outcome).toEqual({ outcome: 'written', version: 2 })
    expect(await revisionsOf(`ent_current_${slug}`)).toEqual([
      {
        id: `rev_${slug}_one`,
        entry_id: `ent_current_${slug}`,
        markdown: '# Draft one',
        created_at: '2026-10-12T10:00:00Z',
      },
    ])
    expect(await entryRow(`ent_current_${slug}`)).toEqual({
      id: `ent_current_${slug}`,
      version: 2,
      head_rev: `rev_${slug}_one`,
    })
  })

  it('with a stale version inserts nothing and bumps nothing: RETURNING is empty', async () => {
    await seedEntry(`ent_stale_${slug}`, 3)

    const outcome = await write(input(`ent_stale_${slug}`, 2, 'stale'))

    expect(outcome).toEqual({ outcome: 'conflict' })
    expect(await revisionsOf(`ent_stale_${slug}`)).toEqual([])
    expect(await entryRow(`ent_stale_${slug}`)).toEqual({
      id: `ent_stale_${slug}`,
      version: 3,
      head_rev: null,
    })
  })

  it('replaying a write that already landed is a conflict and leaves the first revision alone', async () => {
    await seedEntry(`ent_replay_${slug}`, 1)
    await write(input(`ent_replay_${slug}`, 1, 'first'))

    const outcome = await write(input(`ent_replay_${slug}`, 1, 'second'))

    expect(outcome).toEqual({ outcome: 'conflict' })
    expect(await revisionsOf(`ent_replay_${slug}`)).toEqual([
      {
        id: `rev_${slug}_first`,
        entry_id: `ent_replay_${slug}`,
        markdown: '# Draft first',
        created_at: '2026-10-12T10:00:00Z',
      },
    ])
    expect(await entryRow(`ent_replay_${slug}`)).toEqual({
      id: `ent_replay_${slug}`,
      version: 2,
      head_rev: `rev_${slug}_first`,
    })
  })

  it('answers conflict for an entry that does not exist: an empty RETURNING cannot tell stale from missing', async () => {
    const outcome = await write(input(`ent_missing_${slug}`, 1, 'ghost'))

    expect(outcome).toEqual({ outcome: 'conflict' })
    expect(await revisionsOf(`ent_missing_${slug}`)).toEqual([])
  })

  it('increments the version by one per write, each carrying the version the last one returned', async () => {
    await seedEntry(`ent_chain_${slug}`, 1)

    const first = await write(input(`ent_chain_${slug}`, 1, 'a'))
    const second = await write(input(`ent_chain_${slug}`, 2, 'b'))
    const third = await write(input(`ent_chain_${slug}`, 3, 'c'))

    expect([first, second, third]).toEqual([
      { outcome: 'written', version: 2 },
      { outcome: 'written', version: 3 },
      { outcome: 'written', version: 4 },
    ])
    expect((await revisionsOf(`ent_chain_${slug}`)).map((row) => row.id)).toEqual([
      `rev_${slug}_a`,
      `rev_${slug}_b`,
      `rev_${slug}_c`,
    ])
    expect(await entryRow(`ent_chain_${slug}`)).toEqual({
      id: `ent_chain_${slug}`,
      version: 4,
      head_rev: `rev_${slug}_c`,
    })
  })
})

describe('what drizzle emits for the batch', () => {
  const write: RevisionWrite = {
    entryId: 'ent_sql',
    expectedVersion: 7,
    revisionId: 'rev_sql',
    markdown: '# SQL',
    createdAt: '2026-10-12T10:00:00Z',
  }

  it('expresses INSERT...SELECT and UPDATE...RETURNING with the query builder', () => {
    const [insertRevision, bumpVersion] = revisionWriteStatements(drizzle(env.DB), write)

    expect(insertRevision.toSQL()).toEqual({
      sql:
        'insert into "revisions" ("id", "entry_id", "markdown", "created_at") ' +
        'select ? as "rev_id", "id", ? as "rev_markdown", ? as "rev_created_at" ' +
        'from "entries" where ("entries"."id" = ? and "entries"."version" = ?)',
      params: ['rev_sql', '# SQL', '2026-10-12T10:00:00Z', 'ent_sql', 7],
    })
    expect(bumpVersion.toSQL()).toEqual({
      sql:
        'update "entries" set "version" = "entries"."version" + 1, "head_rev" = ? ' +
        'where ("entries"."id" = ? and "entries"."version" = ?) returning "version"',
      params: ['rev_sql', 'ent_sql', 7],
    })
  })

  it('prepares exactly those two statements, in that order, when db.batch runs', async () => {
    const prepared: string[] = []
    const db = drizzle(recordingDatabase(env.DB, prepared))
    await seedEntry('ent_prepared', 1)

    await writeRevision(db, {
      ...write,
      entryId: 'ent_prepared',
      expectedVersion: 1,
      revisionId: 'rev_prepared',
    })

    expect(prepared).toEqual([
      'insert into "revisions" ("id", "entry_id", "markdown", "created_at") ' +
        'select ? as "rev_id", "id", ? as "rev_markdown", ? as "rev_created_at" ' +
        'from "entries" where ("entries"."id" = ? and "entries"."version" = ?)',
      'update "entries" set "version" = "entries"."version" + 1, "head_rev" = ? ' +
        'where ("entries"."id" = ? and "entries"."version" = ?) returning "version"',
    ])
  })

  it('is invisible to the drizzle logger: db.batch never calls logQuery, a lone statement does', async () => {
    const logged: string[] = []
    const db = drizzle(env.DB, {
      logger: {
        logQuery: (query) => {
          logged.push(query)
        },
      },
    })
    await seedEntry('ent_logger', 1)

    await writeRevision(db, {
      ...write,
      entryId: 'ent_logger',
      expectedVersion: 1,
      revisionId: 'rev_logger',
    })
    const afterBatch = [...logged]
    await db.select().from(entries)

    expect(afterBatch).toEqual([])
    expect(logged).toEqual(['select "id", "version", "head_rev" from "entries"'])
  })

  it('hands db.batch the raw D1 result of the INSERT (meta.changes) and the mapped RETURNING rows', async () => {
    const db = drizzle(env.DB)
    await seedEntry('ent_meta', 5)

    const [current, currentBumped] = await db.batch(
      revisionWriteStatements(db, { ...write, entryId: 'ent_meta', expectedVersion: 5 }),
    )
    const [stale, staleBumped] = await db.batch(
      revisionWriteStatements(db, {
        ...write,
        entryId: 'ent_meta',
        expectedVersion: 5,
        revisionId: 'rev_stale',
      }),
    )

    expect([current.meta.changes, currentBumped]).toEqual([1, [{ version: 6 }]])
    expect([stale.meta.changes, staleBumped]).toEqual([0, []])
  })

  it('refuses a selection that is not every column of revisions in table order', async () => {
    const db = drizzle(env.DB)

    // The type checker refuses it first (the mapped type asks for all four keys). The runtime
    // check is `haveSameKeys` in drizzle-orm sqlite-core/query-builders/insert.js.
    const error = await rejection(async () =>
      // @ts-expect-error markdown and createdAt are missing from the selection
      db.insert(revisions).select((qb) =>
        qb
          .select({
            id: sql<string>`'rev_x'`.as('rev_id'),
            entryId: entries.id,
          })
          .from(entries),
      ),
    )

    expect(error.message).toBe(
      'Insert select error: selected fields are not the same or are in a different order compared to the table definition',
    )
  })
})

describe('why the write is a batch and not a transaction', () => {
  it('refuses BEGIN: drizzle db.transaction() cannot run on D1', async () => {
    const db = drizzle(env.DB)

    const error = await rejection(() =>
      db.transaction(async (tx) => {
        await tx.insert(entries).values({ id: 'ent_tx', version: 1 })
      }),
    )

    expect(error.message).toBe('Failed query: begin\nparams: ')
    expect(rootMessage(error)).toBe(
      "To execute a transaction, please use the state.storage.transaction() or state.storage.transactionSync() APIs instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements. The JavaScript API is safer because it will automatically roll back on exceptions, and because it interacts correctly with Durable Objects' automatic atomic write coalescing.",
    )
    expect(await entryRow('ent_tx')).toBeNull()
  })
})
