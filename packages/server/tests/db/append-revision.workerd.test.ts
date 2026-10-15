import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import type { ContentStore, EntryView } from '../../src/ports.ts'
import {
  countRows,
  entryRow,
  fixedClock,
  idFactory,
  insertEntries,
  newRevision,
  recordStatements,
  seedOwner,
  siteKey,
  storedTags,
  VERDICT,
} from './support.ts'

// Fails when: src/db/writes.ts appendRevision or src/db/statements.ts lose the version predicate
// of the optimistic write (`version = ?` on the revision's INSERT ... SELECT, or on the entry's
// UPDATE ... RETURNING: a stale write then lands, or lands half), stop inserting the tags only
// WHERE EXISTS their revision (a stale write with tags then fails a foreign key instead of
// answering `conflict`), stop sending the revision, its tags and the entry's update as one batch
// (a write that fails halfway then leaves the revision, or the tags, behind), stop bumping the
// version by one, moving head_rev, updated_at and translation_group, touch what is published, stop
// telling `conflict` (with the current version and head revision) from `not_found` after an empty
// RETURNING, stop answering `taken` for a translation another entry holds (writing nothing), or
// stop cutting the tags into statements under the limit of bound values (150 tags must work).

const T1 = '2026-10-12T10:00:00.000Z'
const T2 = '2026-10-12T11:00:00.000Z'
const T3 = '2026-10-12T12:00:00.000Z'

/** A draft at version 1 with one revision, `rev_a`, and one tag. */
async function seedDraft(label: string) {
  const owner = await seedOwner(env.DB, siteKey(label))
  const id = idFactory()
  await insertEntries(env.DB, owner, [
    {
      id: id('ent_a'),
      slug: 'a',
      translationGroup: 'g1',
      updatedAt: T1,
      revisions: [{ id: id('rev_a'), markdown: 'first', tags: ['old'] }],
    },
  ])
  const time = fixedClock(T2)
  return {
    owner,
    id,
    entryId: id('ent_a'),
    time,
    store: createD1Store(env.DB, { clock: time.clock }),
  }
}

/** The view of an entry that was saved, or a failure that says what else the store answered. */
async function saved(answer: ReturnType<ContentStore['appendRevision']>): Promise<EntryView> {
  const result = await answer
  if (result.outcome !== 'saved') throw new Error(`Not saved: ${JSON.stringify(result)}`)
  return result.view
}

describe('appendRevision', () => {
  it('makes the new revision the head, bumps the version, and keeps the revision before it', async () => {
    const { owner, id, entryId, store } = await seedDraft('append')

    const result = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 1,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, {
        markdown: 'second',
        tags: ['old', 'new'],
        actor: { ...owner.actor, meta: { client: 'claude-code' } },
      }),
    })

    if (result.outcome !== 'saved') throw new Error(`Not saved: ${JSON.stringify(result)}`)
    const { entry, revision } = result.view
    expect(result.view).toEqual({
      entry: {
        id: entryId,
        collection: 'blog',
        locale: 'en',
        slug: 'a',
        translationGroup: 'g1',
        status: 'draft',
        version: 2,
        headRevision: revision.id,
        publishedRevision: null,
        publishedAt: null,
        updatedAt: T2,
      },
      revision: {
        id: revision.id,
        entryId,
        markdown: 'second',
        frontmatter: { title: 'Hello' },
        document: { nodes: [['p', {}, 'Hello world']], frontmatter: { title: 'Hello' }, meta: {} },
        comarkVersion: '0.7.0',
        pipelineVersion: '1',
        wordCount: 2,
        verdict: VERDICT,
        tags: ['new', 'old'],
        actor: { ...owner.actor, meta: { client: 'claude-code' } },
        createdAt: T2,
      },
    })
    expect(revision.id).not.toBe(id('rev_a'))
    // Reading it back gives the same view.
    expect(await store.findEntryById(owner.site, entryId, 'head')).toEqual(result.view)
    // The entry as the database holds it: created_at stays, the rest moved.
    expect(await entryRow(env.DB, entryId)).toEqual({
      id: entryId,
      site_id: owner.site,
      collection: 'blog',
      locale: 'en',
      slug: 'a',
      translation_group: 'g1',
      status: 'draft',
      version: 2,
      head_rev: entry.headRevision,
      published_rev: null,
      published_at: null,
      published_sort_key: null,
      scheduled_at: null,
      created_at: T1,
      updated_at: T2,
    })
    // The first revision and its tags are still there, as they were.
    expect(
      await env.DB.prepare(
        'SELECT id, markdown, created_at FROM revisions WHERE entry_id = ? ORDER BY created_at',
      )
        .bind(entryId)
        .all(),
    ).toMatchObject({
      results: [
        { id: id('rev_a'), markdown: 'first', created_at: T1 },
        { id: revision.id, markdown: 'second', created_at: T2 },
      ],
    })
    expect(await storedTags(env.DB, id('rev_a'))).toEqual(['old'])
    expect(await storedTags(env.DB, revision.id)).toEqual(['new', 'old'])
  })

  it('moves the entry to the translation group it names, or to none', async () => {
    const { owner, entryId, store } = await seedDraft('append-group')

    await saved(
      store.appendRevision(owner.site, {
        entryId,
        expectedVersion: 1,
        translationGroup: 'g2',
        revision: newRevision(owner.actor),
      }),
    )
    expect((await entryRow(env.DB, entryId))?.translation_group).toBe('g2')

    await saved(
      store.appendRevision(owner.site, {
        entryId,
        expectedVersion: 2,
        translationGroup: null,
        revision: newRevision(owner.actor),
      }),
    )
    expect((await entryRow(env.DB, entryId))?.translation_group).toBeNull()
  })

  it('leaves what is published as it is: the status, the published revision, the time and the sort key', async () => {
    const owner = await seedOwner(env.DB, siteKey('append-live'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_p'),
        slug: 'p',
        updatedAt: T1,
        revisions: [{ id: id('rev_p'), markdown: 'live' }],
        published: { revision: id('rev_p'), sortKey: 'k1', at: T1 },
      },
    ])
    const store = createD1Store(env.DB, { clock: fixedClock(T3).clock })

    const view = await saved(
      store.appendRevision(owner.site, {
        entryId: id('ent_p'),
        expectedVersion: 1,
        translationGroup: null,
        revision: newRevision(owner.actor, { markdown: 'next' }),
      }),
    )

    expect(view.entry).toMatchObject({
      status: 'published',
      version: 2,
      publishedRevision: id('rev_p'),
      publishedAt: T1,
      updatedAt: T3,
    })
    expect(view.entry.headRevision).not.toBe(id('rev_p'))
    expect(await entryRow(env.DB, id('ent_p'))).toMatchObject({
      status: 'published',
      published_rev: id('rev_p'),
      published_at: T1,
      published_sort_key: 'k1',
    })
    expect(
      (
        await store.findEntry(
          owner.site,
          { collection: 'blog', locale: 'en', slug: 'p' },
          'published',
        )
      )?.revision.markdown,
    ).toBe('live')
  })

  it('takes the version of the entry one write at a time: 1, 2, 3, 4', async () => {
    const { owner, entryId, store } = await seedDraft('append-chain')

    const versions: number[] = []
    for (const [index, expectedVersion] of [1, 2, 3].entries()) {
      const view = await saved(
        store.appendRevision(owner.site, {
          entryId,
          expectedVersion,
          translationGroup: 'g1',
          revision: newRevision(owner.actor, { markdown: `write ${index}` }),
        }),
      )
      versions.push(view.entry.version)
    }

    expect(versions).toEqual([2, 3, 4])
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(4)
    expect((await store.findEntryById(owner.site, entryId, 'head'))?.revision.markdown).toBe(
      'write 2',
    )
  })
})

describe('appendRevision against an entry that moved on', () => {
  it('answers conflict, with the current version and head revision, and writes nothing', async () => {
    const { owner, id, entryId, store } = await seedDraft('append-conflict')
    const winner = await saved(
      store.appendRevision(owner.site, {
        entryId,
        expectedVersion: 1,
        translationGroup: 'g1',
        revision: newRevision(owner.actor, { markdown: 'winner', tags: ['w'] }),
      }),
    )
    const before = await entryRow(env.DB, entryId)

    const stale = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 1,
      translationGroup: 'g9',
      revision: newRevision(owner.actor, { markdown: 'late', tags: ['l1', 'l2'] }),
    })

    expect(stale).toEqual({
      outcome: 'conflict',
      currentVersion: 2,
      headRevision: winner.revision.id,
    })
    expect(await entryRow(env.DB, entryId)).toEqual(before)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(2)
    expect(await storedTags(env.DB, id('rev_a'))).toEqual(['old'])
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(2)
  })

  it('answers conflict to a write that is replayed, and to one that is from the future', async () => {
    const { owner, entryId, store } = await seedDraft('append-replay')
    const write = {
      entryId,
      expectedVersion: 1,
      translationGroup: 'g1',
      revision: newRevision(owner.actor),
    }
    await saved(store.appendRevision(owner.site, write))

    const replay = await store.appendRevision(owner.site, write)
    const future = await store.appendRevision(owner.site, { ...write, expectedVersion: 7 })

    expect(replay).toMatchObject({ outcome: 'conflict', currentVersion: 2 })
    expect(future).toMatchObject({ outcome: 'conflict', currentVersion: 2 })
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(2)
  })

  it('answers conflict, and not a foreign key error, to a stale write that carries 30 tags', async () => {
    const { owner, id, entryId, store } = await seedDraft('append-stale-tags')
    await saved(
      store.appendRevision(owner.site, {
        entryId,
        expectedVersion: 1,
        translationGroup: 'g1',
        revision: newRevision(owner.actor),
      }),
    )
    const tagsBefore = await countRows(env.DB, 'revision_tags', owner.site)
    const tags = Array.from({ length: 30 }, (_, i) => `tag-${String(i).padStart(2, '0')}`)

    const stale = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 1,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, { markdown: 'late', tags }),
    })

    expect(stale).toMatchObject({ outcome: 'conflict', currentVersion: 2 })
    expect(tagsBefore).toBe(1)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(2)
    expect(await storedTags(env.DB, id('rev_a'))).toEqual(['old'])
  })

  it('answers not_found for an entry that is not there, and writes nothing', async () => {
    const { owner, id, store } = await seedDraft('append-missing')

    const answer = await store.appendRevision(owner.site, {
      entryId: id('ent_missing'),
      expectedVersion: 1,
      translationGroup: null,
      revision: newRevision(owner.actor, { tags: ['a', 'b'] }),
    })

    expect(answer).toEqual({ outcome: 'not_found' })
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1)
  })
})

describe('appendRevision with writes at the same time', () => {
  it.each([2, 8])(
    'lets exactly one of %i writes at the same version in, and answers conflict to the others',
    async (racers) => {
      const { owner, id, entryId, store } = await seedDraft(`append-race-${racers}`)

      const answers = await Promise.all(
        Array.from({ length: racers }, (_, racer) =>
          store.appendRevision(owner.site, {
            entryId,
            expectedVersion: 1,
            translationGroup: 'g1',
            revision: newRevision(owner.actor, {
              markdown: `racer ${racer}`,
              tags: [`racer-${racer}-a`, `racer-${racer}-b`, `racer-${racer}-c`],
            }),
          }),
        ),
      )

      const winners = answers.filter((answer) => answer.outcome === 'saved')
      const losers = answers.filter((answer) => answer.outcome === 'conflict')
      const [winner] = winners
      if (winner?.outcome !== 'saved') throw new Error(`No winner: ${JSON.stringify(answers)}`)
      expect([winners.length, losers.length]).toEqual([1, racers - 1])
      expect(winner.view.entry.version).toBe(2)
      for (const loser of losers) {
        expect(loser).toEqual({
          outcome: 'conflict',
          currentVersion: 2,
          headRevision: winner.view.revision.id,
        })
      }
      // One revision was added, with the tags of the winner and no others.
      expect(await countRows(env.DB, 'revisions', owner.site)).toBe(2)
      expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1 + 3)
      expect(await storedTags(env.DB, winner.view.revision.id)).toEqual(winner.view.revision.tags)
      expect(await entryRow(env.DB, entryId)).toMatchObject({
        version: 2,
        head_rev: winner.view.revision.id,
      })
      expect(await storedTags(env.DB, id('rev_a'))).toEqual(['old'])
    },
  )
})

describe('appendRevision with many tags', () => {
  it('saves 150 tags, in as many statements as the limit of bound values needs', async () => {
    const { owner, entryId, store } = await seedDraft('append-150')
    const tags = Array.from({ length: 150 }, (_, i) => `tag-${String(i).padStart(3, '0')}`)

    const view = await saved(
      store.appendRevision(owner.site, {
        entryId,
        expectedVersion: 1,
        translationGroup: 'g1',
        revision: newRevision(owner.actor, { tags: tags.toReversed() }),
      }),
    )

    expect(view.revision.tags).toEqual(tags)
    expect(await storedTags(env.DB, view.revision.id)).toEqual(tags)
    expect((await store.findEntryById(owner.site, entryId, 'head'))?.revision.tags).toEqual(tags)
  })
})

describe('appendRevision to a translation group that another entry holds', () => {
  /** `ent_a` (en, group g1), `ent_b` (en, no group), `ent_c` (es, group g2). */
  async function seedGroups() {
    const owner = await seedOwner(env.DB, siteKey('append-taken'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), slug: 'a', translationGroup: 'g1', updatedAt: T1 },
      { id: id('ent_b'), slug: 'b', updatedAt: T1 },
      { id: id('ent_c'), locale: 'es', slug: 'c', translationGroup: 'g2', updatedAt: T1 },
    ])
    return { owner, id, store: createD1Store(env.DB, { clock: fixedClock(T2).clock }) }
  }

  it('answers taken by the holder, and writes nothing: not the revision, not its tags, not the update', async () => {
    const { owner, id, store } = await seedGroups()
    const before = await entryRow(env.DB, id('ent_b'))

    const answer = await store.appendRevision(owner.site, {
      entryId: id('ent_b'),
      expectedVersion: 1,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, { tags: ['x', 'y'] }),
    })

    expect(answer).toEqual({ outcome: 'taken', field: 'translationGroup', by: id('ent_a') })
    expect(await entryRow(env.DB, id('ent_b'))).toEqual(before)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(3)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(0)
  })

  it('lets the entry join the group of an entry in another locale, or a group nobody holds', async () => {
    const { owner, id, store } = await seedGroups()

    // The English entry joins the group of the Spanish one: they are translations of each other.
    await saved(
      store.appendRevision(owner.site, {
        entryId: id('ent_b'),
        expectedVersion: 1,
        translationGroup: 'g2',
        revision: newRevision(owner.actor),
      }),
    )
    await saved(
      store.appendRevision(owner.site, {
        entryId: id('ent_b'),
        expectedVersion: 2,
        translationGroup: 'g3',
        revision: newRevision(owner.actor),
      }),
    )

    expect((await entryRow(env.DB, id('ent_b')))?.translation_group).toBe('g3')
    expect(await store.lookup(owner.site).translations('blog', 'g2')).toHaveLength(1)
  })
})

describe('the optimistic write, as SQL', () => {
  it('is one batch of the revision inserted at the version, its tags inserted where the revision is, a pending review cancelled at the version, and the entry updated at the version, returning it', async () => {
    const { owner, entryId } = await seedDraft('append-sql')
    const { db, prepared, batches } = recordStatements(env.DB)
    const store = createD1Store(db, { clock: fixedClock(T2).clock })

    const answer = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 1,
      translationGroup: null,
      revision: newRevision(owner.actor, { tags: ['a', 'b'] }),
    })

    expect(answer.outcome).toBe('saved')
    expect(batches).toEqual([4])
    expect(prepared).toEqual([
      'insert into "revisions" ("id", "site_id", "entry_id", "markdown", "frontmatter", "document", "comark_version", "pipeline_version", "word_count", "verdict", "actor_kind", "actor_user_id", "actor_token_id", "actor_meta", "created_at", "updated_at") select ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? from "entries" where ("entries"."id" = ? and "entries"."site_id" = ? and "entries"."version" = ?)',
      'insert into "revision_tags" ("id", "site_id", "revision_id", "tag", "created_at", "updated_at") with "t" ("id", "tag") as (values (?, ?), (?, ?)) select "t"."id", ?, ?, "t"."tag", ?, ? from "t" where exists (select 1 from "revisions" where ("revisions"."id" = ? and "revisions"."site_id" = ?))',
      'update "reviews" set "status" = ?, "updated_at" = ? where ("reviews"."site_id" = ? and "reviews"."entry_id" = ? and "reviews"."status" = ? and exists (select 1 from "entries" where ("entries"."id" = ? and "entries"."site_id" = ? and "entries"."version" = ?)))',
      'update "entries" set "translation_group" = ?, "version" = "entries"."version" + 1, "head_rev" = ?, "updated_at" = ? where ("entries"."id" = ? and "entries"."site_id" = ? and "entries"."version" = ?) returning "id", "collection", "locale", "slug", "translation_group", "status", "version", "head_rev", "published_rev", "published_at", "updated_at"',
    ])
  })

  it('asks one more question, outside the batch, only when the batch changed nothing', async () => {
    const { owner, entryId } = await seedDraft('append-sql-stale')
    const { db, prepared, batches } = recordStatements(env.DB)
    const store = createD1Store(db, { clock: fixedClock(T2).clock })

    const stale = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 5,
      translationGroup: null,
      revision: newRevision(owner.actor),
    })

    expect(stale).toMatchObject({ outcome: 'conflict', currentVersion: 1 })
    expect(batches).toEqual([3])
    expect(prepared).toHaveLength(4)
    expect(prepared[3]).toBe(
      'select "version", "head_rev" from "entries" where ("entries"."site_id" = ? and "entries"."id" = ?) limit ?',
    )
  })
})
