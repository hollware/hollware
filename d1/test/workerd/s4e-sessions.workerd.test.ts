import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'
import { entries } from '../../src/schema.ts'
import { sessionAsDatabase } from '../../src/session-db.ts'
import { seedEntry } from './support.ts'

// Fails when: src/session-db.ts stops forwarding prepare/batch to the session (drizzle would then
// run on the primary and the session bookmark would stop advancing), or drizzle-orm's D1 driver
// starts accepting a raw D1DatabaseSession at compile time (the @ts-expect-error below goes
// unused: drop the adapter), or workerd changes what a session returns before and after a query.

// What the local runtime hands out: `00000000-<counter>-00000000-<32 zeros>`. Production
// bookmarks have the same four-group shape but are opaque.
const LOCAL_BOOKMARK = /^00000000-[0-9a-f]{8}-00000000-0{32}$/

describe('env.DB.withSession() in Miniflare', () => {
  it("returns a session with prepare, batch and getBookmark for 'first-unconstrained'", () => {
    const session = env.DB.withSession('first-unconstrained')

    expect(session.constructor.name).toBe('D1DatabaseSession')
    expect(typeof session.prepare).toBe('function')
    expect(typeof session.batch).toBe('function')
    expect(typeof session.getBookmark).toBe('function')
  })

  it('has no bookmark until its first query, then one per query that only goes up', async () => {
    const session = env.DB.withSession('first-unconstrained')
    const before = session.getBookmark()

    await session.prepare('SELECT 1 AS one').all()
    const afterFirst = session.getBookmark()
    await session.prepare('SELECT 2 AS two').all()
    const afterSecond = session.getBookmark()

    expect(before).toBeNull()
    expect(afterFirst).toMatch(LOCAL_BOOKMARK)
    expect(afterSecond).toMatch(LOCAL_BOOKMARK)
    expect(afterSecond !== null && afterFirst !== null && afterSecond > afterFirst).toBe(true)
  })

  it.each([
    ['no argument', undefined],
    ['an empty string', ''],
    ["'first-primary'", 'first-primary'],
  ] as const)(
    'treats %s like a constraint: no bookmark before the first query',
    async (_label, argument) => {
      const session = env.DB.withSession(argument)

      expect(session.getBookmark()).toBeNull()
      await session.prepare('SELECT 1 AS one').all()
      expect(session.getBookmark()).toMatch(LOCAL_BOOKMARK)
    },
  )

  it('starts a session anchored at a bookmark it was given', async () => {
    const first = env.DB.withSession('first-unconstrained')
    await first.prepare('SELECT 1 AS one').all()
    const bookmark = first.getBookmark()
    if (bookmark === null) throw new Error('the first session has no bookmark after a query')

    const second = env.DB.withSession(bookmark)

    expect(second.getBookmark()).toBe(bookmark)
    expect(await second.prepare('SELECT 7 AS seven').first()).toEqual({ seven: 7 })
  })

  it('never waits for or validates a bookmark: a made-up one from the far future answers at once', async () => {
    const session = env.DB.withSession(`ffffffff-ffffffff-ffffffff-${'f'.repeat(32)}`)

    expect(await session.prepare('SELECT 1 AS one').first()).toEqual({ one: 1 })
  })

  it('writes through a session, and the primary binding reads what it wrote', async () => {
    const session = env.DB.withSession('first-primary')

    const result = await session
      .prepare('INSERT INTO entries (id, version, head_rev) VALUES (?, ?, NULL)')
      .bind('ent_session_write', 1)
      .run()

    expect(result.meta.changes).toBe(1)
    expect(session.getBookmark()).toMatch(LOCAL_BOOKMARK)
    expect(
      await env.DB.prepare('SELECT id, version FROM entries WHERE id = ?')
        .bind('ent_session_write')
        .first(),
    ).toEqual({ id: 'ent_session_write', version: 1 })
  })
})

describe('drizzle on top of a session', () => {
  it('runs reads, a write and a batch through the session: its bookmark advances with each', async () => {
    await seedEntry('ent_session_read', 1)
    const session = env.DB.withSession('first-unconstrained')
    const db = drizzle(sessionAsDatabase(session))

    const rows = await db.select().from(entries).where(eq(entries.id, 'ent_session_read'))
    const afterSelect = session.getBookmark()
    await db.insert(entries).values({ id: 'ent_session_dz_write', version: 1 })
    const afterInsert = session.getBookmark()
    const [byId, versions] = await db.batch([
      db.select().from(entries).where(eq(entries.id, 'ent_session_dz_write')),
      db
        .select({ version: entries.version })
        .from(entries)
        .where(eq(entries.id, 'ent_session_read')),
    ])
    const afterBatch = session.getBookmark()

    expect(rows).toEqual([{ id: 'ent_session_read', version: 1, headRev: null }])
    expect(byId).toEqual([{ id: 'ent_session_dz_write', version: 1, headRev: null }])
    expect(versions).toEqual([{ version: 1 }])
    expect(afterSelect).toMatch(LOCAL_BOOKMARK)
    expect(afterInsert !== null && afterSelect !== null && afterInsert > afterSelect).toBe(true)
    expect(afterBatch !== null && afterInsert !== null && afterBatch > afterInsert).toBe(true)
  })

  it('is refused by the types when handed a raw session, although the runtime would accept it', async () => {
    await seedEntry('ent_session_raw', 1)
    const session = env.DB.withSession('first-unconstrained')

    // @ts-expect-error D1DatabaseSession lacks exec, withSession and dump, which D1Database has
    const db = drizzle(session)

    expect(await db.select().from(entries).where(eq(entries.id, 'ent_session_raw'))).toEqual([
      { id: 'ent_session_raw', version: 1, headRev: null },
    ])
    expect(session.getBookmark()).toMatch(LOCAL_BOOKMARK)
  })

  it('has an adapter whose unused D1Database methods fail loudly', () => {
    const database = sessionAsDatabase(env.DB.withSession('first-unconstrained'))

    expect(() => database.exec('SELECT 1')).toThrow(
      'D1 sessions have no exec(): use the primary binding',
    )
    expect(() => database.withSession()).toThrow(
      'D1 sessions have no withSession(): use the primary binding',
    )
  })
})
