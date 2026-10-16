import { isId } from '@hollware/core'
import type { AcknowledgedWarning, Verdict } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import type { Actor, ContentStore } from '../../src/ports.ts'
import {
  countRows,
  entryRow,
  fixedClock,
  idFactory,
  insertEntries,
  newRevision,
  seedOwner,
  siteKey,
  type Owner,
} from './support.ts'

// Fails when: src/db/writes.ts publish stops inserting the publication and updating the entry as
// one batch, both only if the entry is still at the version the caller read (a stale publish then
// lands, or lands half), stops publishing the head revision as it is when the statement runs,
// keeps no first-publication time (`published_at` must stay when an entry is published again),
// stops recording the verdict, the acknowledged warnings and the actor, moving the sort key,
// bumping the version once, or telling `conflict` from `not_found`; unpublish stops taking only
// an entry that is published (one that is not must stay as it is, with no publication appended),
// keeps `published_at` or stops nulling `published_rev` and `published_sort_key`, stops answering
// with the head view of the entry, or `not_found` for an entry that is not there; or lastPublication
// stops returning the newest publication of the entry (by time, then by insertion order).

const T1 = '2026-10-12T10:00:00.000Z'
const T2 = '2026-10-12T11:00:00.000Z'
const T3 = '2026-10-12T12:00:00.000Z'
const T4 = '2026-10-12T13:00:00.000Z'

const PUBLISH_VERDICT: Verdict = {
  ok: true,
  phase: 'publish',
  errors: [],
  warnings: [
    {
      contract: 'seo-title-length',
      severity: 'warning',
      path: '/frontmatter/title',
      message: 'The title is 64 characters long',
      fix: 'Shorten the title to 60 characters or fewer',
    },
  ],
  contractsHash: 'h2',
}

const ACKNOWLEDGED: AcknowledgedWarning[] = [
  { contract: 'seo-title-length', path: '/frontmatter/title' },
]

const ENTRY = { collection: 'blog', locale: 'en', slug: 'a' }

/** A draft at version 1 with one revision, `rev_a`, and a store whose clock the test moves. */
async function seedDraft(label: string) {
  const owner = await seedOwner(env.DB, siteKey(label))
  const id = idFactory()
  await insertEntries(env.DB, owner, [
    {
      id: id('ent_a'),
      ...ENTRY,
      translationGroup: 'g1',
      updatedAt: T1,
      revisions: [{ id: id('rev_a'), markdown: 'first', tags: ['t'] }],
    },
  ])
  const time = fixedClock(T2)
  const store = createD1Store(env.DB, { clock: time.clock })
  return { owner, id, entryId: id('ent_a'), time, store }
}

function publishInput(
  owner: Owner,
  entryId: string,
  expectedVersion: number,
  overrides: Partial<Parameters<ContentStore['publish']>[1]> = {},
): Parameters<ContentStore['publish']>[1] {
  return {
    entryId,
    expectedVersion,
    verdict: PUBLISH_VERDICT,
    acknowledged: ACKNOWLEDGED,
    actor: owner.actor,
    sortKey: '2026-10-05',
    ...overrides,
  }
}

async function publicationRows(entryId: string) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM publications WHERE entry_id = ? ORDER BY rowid',
  )
    .bind(entryId)
    .all()
  return results
}

describe('publish', () => {
  it('publishes the head revision: the entry is published at the head, with a publication that says how', async () => {
    const { owner, id, entryId, time, store } = await seedDraft('publish')
    const actor: Actor = { ...owner.actor, meta: { client: 'claude-code' } }
    time.set(T3)

    const result = await store.publish(
      owner.site,
      publishInput(owner, entryId, 1, { actor, sortKey: '2026-10-05' }),
    )

    if (result.outcome !== 'published') throw new Error(`Not published: ${JSON.stringify(result)}`)
    expect(result.view.entry).toEqual({
      id: entryId,
      collection: 'blog',
      locale: 'en',
      slug: 'a',
      translationGroup: 'g1',
      status: 'published',
      version: 2,
      headRevision: id('rev_a'),
      publishedRevision: id('rev_a'),
      publishedAt: T3,
      scheduledAt: null,
      deletedAt: null,
      updatedAt: T3,
    })
    expect(result.view.revision).toMatchObject({
      id: id('rev_a'),
      entryId,
      markdown: 'first',
      tags: ['t'],
    })
    expect(await entryRow(env.DB, entryId)).toEqual({
      id: entryId,
      site_id: owner.site,
      collection: 'blog',
      locale: 'en',
      slug: 'a',
      translation_group: 'g1',
      status: 'published',
      version: 2,
      head_rev: id('rev_a'),
      published_rev: id('rev_a'),
      published_at: T3,
      published_sort_key: '2026-10-05',
      scheduled_at: null,
      deleted_at: null,
      created_at: T1,
      updated_at: T3,
    })
    // The publication, as the database holds it.
    const [row, ...others] = await publicationRows(entryId)
    expect(others).toEqual([])
    expect(row).toMatchObject({
      site_id: owner.site,
      entry_id: entryId,
      action: 'publish',
      revision_id: id('rev_a'),
      acknowledged: '[{"contract":"seo-title-length","path":"/frontmatter/title"}]',
      actor_kind: 'token',
      actor_user_id: owner.actor.userId,
      actor_token_id: owner.actor.tokenId,
      actor_meta: '{"client":"claude-code"}',
      created_at: T3,
      updated_at: T3,
    })
    expect(JSON.parse(String(row?.verdict))).toEqual(PUBLISH_VERDICT)
    // And as the store reads it back.
    const last = await store.lastPublication(owner.site, entryId)
    expect(isId('pub', last?.id ?? '')).toBe(true)
    expect(last).toEqual({
      id: String(row?.id),
      entryId,
      action: 'publish',
      revisionId: id('rev_a'),
      verdict: PUBLISH_VERDICT,
      acknowledged: ACKNOWLEDGED,
      actor,
      createdAt: T3,
    })
    // It is live: the published view reads it, and the published listing lists it.
    expect((await store.findEntry(owner.site, ENTRY, 'published'))?.revision.id).toBe(id('rev_a'))
    const page = await store.listEntries(owner.site, {
      collection: 'blog',
      view: 'published',
      limit: 10,
    })
    expect(page.entries.map((view) => view.entry.id)).toEqual([entryId])
    expect(
      await store.listEntries(owner.site, {
        collection: 'blog',
        view: 'published',
        limit: 10,
        tag: 't',
      }),
    ).toMatchObject({ entries: [{ entry: { id: entryId } }] })
  })

  it('publishes the head revision as it is, not the one the entry had when it was last published', async () => {
    const { owner, id, entryId, time, store } = await seedDraft('publish-head')
    time.set(T2)
    await store.publish(owner.site, publishInput(owner, entryId, 1))
    time.set(T3)
    const edited = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 2,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, { markdown: 'second', tags: ['u'] }),
    })
    if (edited.outcome !== 'saved') throw new Error('The edit was not saved')
    // The live page still shows the first revision, and the entry says it has unpublished changes.
    expect((await store.findEntry(owner.site, ENTRY, 'published'))?.revision.markdown).toBe('first')
    expect(edited.view.entry).toMatchObject({
      headRevision: edited.view.revision.id,
      publishedRevision: id('rev_a'),
    })

    time.set(T4)
    const again = await store.publish(
      owner.site,
      publishInput(owner, entryId, 3, { sortKey: 'k2' }),
    )

    if (again.outcome !== 'published') throw new Error(`Not published: ${JSON.stringify(again)}`)
    expect(again.view.entry.publishedRevision).toBe(edited.view.revision.id)
    expect(again.view.revision).toMatchObject({ markdown: 'second', tags: ['u'] })
    expect((await store.findEntry(owner.site, ENTRY, 'published'))?.revision.markdown).toBe(
      'second',
    )
  })

  it('keeps the time of the first publication when it is published again, and moves the sort key', async () => {
    const { owner, id, entryId, time, store } = await seedDraft('publish-again')
    time.set(T1)
    await store.publish(owner.site, publishInput(owner, entryId, 1, { sortKey: 'k1' }))
    time.set(T2)
    const edited = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 2,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, { markdown: 'second' }),
    })
    if (edited.outcome !== 'saved') throw new Error('The edit was not saved')

    time.set(T3)
    const again = await store.publish(
      owner.site,
      publishInput(owner, entryId, 3, { sortKey: 'k2' }),
    )

    if (again.outcome !== 'published') throw new Error(`Not published: ${JSON.stringify(again)}`)
    expect(again.view.entry).toMatchObject({ version: 4, publishedAt: T1, updatedAt: T3 })
    expect(await entryRow(env.DB, entryId)).toMatchObject({
      status: 'published',
      version: 4,
      published_rev: edited.view.revision.id,
      published_at: T1,
      published_sort_key: 'k2',
      updated_at: T3,
    })
    // Both publications are there, the first one as it was.
    const rows = await publicationRows(entryId)
    expect(rows.map((row) => [row.action, row.revision_id, row.created_at])).toEqual([
      ['publish', id('rev_a'), T1],
      ['publish', edited.view.revision.id, T3],
    ])
    expect((await store.lastPublication(owner.site, entryId))?.createdAt).toBe(T3)
  })

  it('answers conflict, with the current version and head revision, to a publish at a version that moved, and writes nothing', async () => {
    const { owner, entryId, time, store } = await seedDraft('publish-stale')
    time.set(T2)
    const edited = await store.appendRevision(owner.site, {
      entryId,
      expectedVersion: 1,
      translationGroup: 'g1',
      revision: newRevision(owner.actor, { markdown: 'second' }),
    })
    if (edited.outcome !== 'saved') throw new Error('The edit was not saved')
    const before = await entryRow(env.DB, entryId)

    time.set(T3)
    const stale = await store.publish(owner.site, publishInput(owner, entryId, 1))

    expect(stale).toEqual({
      outcome: 'conflict',
      currentVersion: 2,
      headRevision: edited.view.revision.id,
    })
    expect(await entryRow(env.DB, entryId)).toEqual(before)
    expect(await publicationRows(entryId)).toEqual([])
    expect(await store.findEntry(owner.site, ENTRY, 'published')).toBeNull()
  })

  it('answers not_found for an entry that is not there, and writes nothing', async () => {
    const { owner, id, store } = await seedDraft('publish-missing')

    const answer = await store.publish(owner.site, publishInput(owner, id('ent_missing'), 1))

    expect(answer).toEqual({ outcome: 'not_found' })
    expect(await countRows(env.DB, 'publications', owner.site)).toBe(0)
  })

  it.each([2, 8])(
    'lets exactly one of %i publishes at the same version in, and answers conflict to the others',
    async (racers) => {
      const { owner, id, entryId, time, store } = await seedDraft(`publish-race-${racers}`)
      time.set(T3)

      const answers = await Promise.all(
        Array.from({ length: racers }, (_, racer) =>
          store.publish(owner.site, publishInput(owner, entryId, 1, { sortKey: `k${racer}` })),
        ),
      )

      const winners = answers.filter((answer) => answer.outcome === 'published')
      const losers = answers.filter((answer) => answer.outcome === 'conflict')
      expect([winners.length, losers.length]).toEqual([1, racers - 1])
      for (const loser of losers) {
        expect(loser).toEqual({ outcome: 'conflict', currentVersion: 2, headRevision: id('rev_a') })
      }
      expect(await countRows(env.DB, 'publications', owner.site)).toBe(1)
      expect(await entryRow(env.DB, entryId)).toMatchObject({ status: 'published', version: 2 })
    },
  )

  it('refuses a publication that would be over the size of a row, and writes nothing', async () => {
    const { owner, entryId, store } = await seedDraft('publish-large')
    const huge: AcknowledgedWarning[] = [{ contract: 'x'.repeat(1_950_000), path: '/frontmatter' }]
    const before = await entryRow(env.DB, entryId)

    const answer = await store.publish(
      owner.site,
      publishInput(owner, entryId, 1, { acknowledged: huge }),
    )

    expect(answer).toMatchObject({ outcome: 'too_large', limit: 1_900_000 })
    expect(answer.outcome === 'too_large' && answer.bytes).toBeGreaterThan(1_950_000)
    expect(await entryRow(env.DB, entryId)).toEqual(before)
    expect(await countRows(env.DB, 'publications', owner.site)).toBe(0)
  })
})

describe('unpublish', () => {
  /** A published entry: `rev_a`, published at T1, sort key k1, at version 2. */
  async function seedPublished(label: string) {
    const seeded = await seedDraft(label)
    seeded.time.set(T1)
    const published = await seeded.store.publish(
      seeded.owner.site,
      publishInput(seeded.owner, seeded.entryId, 1, { sortKey: 'k1' }),
    )
    if (published.outcome !== 'published') throw new Error('The seed was not published')
    seeded.time.set(T3)
    return seeded
  }

  it('takes a published entry back to a draft, keeps when it was first published, and appends the unpublish', async () => {
    const { owner, id, entryId, store } = await seedPublished('unpublish')
    const actor: Actor = { ...owner.actor, meta: { client: 'claude-code' } }

    const result = await store.unpublish(owner.site, { entryId, actor })

    if (result.outcome !== 'unpublished')
      throw new Error(`Not unpublished: ${JSON.stringify(result)}`)
    // The answer is the head view of the entry, which is a draft now.
    expect(result.view.entry).toEqual({
      id: entryId,
      collection: 'blog',
      locale: 'en',
      slug: 'a',
      translationGroup: 'g1',
      status: 'draft',
      version: 3,
      headRevision: id('rev_a'),
      publishedRevision: null,
      publishedAt: T1,
      scheduledAt: null,
      deletedAt: null,
      updatedAt: T3,
    })
    expect(result.view.revision.id).toBe(id('rev_a'))
    expect(await entryRow(env.DB, entryId)).toMatchObject({
      status: 'draft',
      version: 3,
      head_rev: id('rev_a'),
      published_rev: null,
      published_at: T1,
      published_sort_key: null,
      updated_at: T3,
    })
    const rows = await publicationRows(entryId)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({
      site_id: owner.site,
      entry_id: entryId,
      action: 'unpublish',
      revision_id: null,
      verdict: null,
      acknowledged: '[]',
      actor_kind: 'token',
      actor_user_id: owner.actor.userId,
      actor_token_id: owner.actor.tokenId,
      actor_meta: '{"client":"claude-code"}',
      created_at: T3,
    })
    expect(await store.lastPublication(owner.site, entryId)).toEqual({
      id: String(rows[1]?.id),
      entryId,
      action: 'unpublish',
      revisionId: null,
      verdict: null,
      acknowledged: [],
      actor,
      createdAt: T3,
    })
    // It is off the public site, and still there as a draft.
    expect(await store.findEntry(owner.site, ENTRY, 'published')).toBeNull()
    expect(
      (await store.listEntries(owner.site, { collection: 'blog', view: 'published', limit: 10 }))
        .entries,
    ).toEqual([])
    expect((await store.findEntry(owner.site, ENTRY, 'head'))?.entry.status).toBe('draft')
  })

  it('leaves an entry that is not published as it is, and still answers with its current view', async () => {
    const { owner, id, entryId, store } = await seedDraft('unpublish-draft')
    const before = await entryRow(env.DB, entryId)

    const result = await store.unpublish(owner.site, { entryId, actor: owner.actor })

    if (result.outcome !== 'unpublished')
      throw new Error(`Not unpublished: ${JSON.stringify(result)}`)
    expect(result.view.entry).toMatchObject({ status: 'draft', version: 1, updatedAt: T1 })
    expect(result.view.revision.id).toBe(id('rev_a'))
    expect(await entryRow(env.DB, entryId)).toEqual(before)
    expect(await countRows(env.DB, 'publications', owner.site)).toBe(0)
  })

  it('takes an entry off once: unpublishing it again changes nothing and appends nothing', async () => {
    const { owner, entryId, store } = await seedPublished('unpublish-twice')
    await store.unpublish(owner.site, { entryId, actor: owner.actor })
    const afterFirst = await entryRow(env.DB, entryId)

    const second = await store.unpublish(owner.site, { entryId, actor: owner.actor })

    expect(second).toMatchObject({ outcome: 'unpublished', view: { entry: { version: 3 } } })
    expect(await entryRow(env.DB, entryId)).toEqual(afterFirst)
    expect(await publicationRows(entryId)).toHaveLength(2)
  })

  it('answers not_found for an entry that is not there, and writes nothing', async () => {
    const { owner, id, store } = await seedDraft('unpublish-missing')

    const answer = await store.unpublish(owner.site, {
      entryId: id('ent_missing'),
      actor: owner.actor,
    })

    expect(answer).toEqual({ outcome: 'not_found' })
    expect(await countRows(env.DB, 'publications', owner.site)).toBe(0)
  })

  it('appends one unpublish, and bumps the version once, when two unpublishes race', async () => {
    const { owner, entryId, store } = await seedPublished('unpublish-race')

    const answers = await Promise.all([
      store.unpublish(owner.site, { entryId, actor: owner.actor }),
      store.unpublish(owner.site, { entryId, actor: owner.actor }),
    ])

    expect(answers.map((answer) => answer.outcome)).toEqual(['unpublished', 'unpublished'])
    expect((await publicationRows(entryId)).map((row) => row.action)).toEqual([
      'publish',
      'unpublish',
    ])
    expect(await entryRow(env.DB, entryId)).toMatchObject({ status: 'draft', version: 3 })
  })

  it('keeps the first publication time through publish, unpublish and publish again', async () => {
    const { owner, entryId, time, store } = await seedPublished('unpublish-republish')
    time.set(T3)
    await store.unpublish(owner.site, { entryId, actor: owner.actor })

    time.set(T4)
    const again = await store.publish(
      owner.site,
      publishInput(owner, entryId, 3, { sortKey: 'k9' }),
    )

    if (again.outcome !== 'published') throw new Error(`Not published: ${JSON.stringify(again)}`)
    expect(again.view.entry).toMatchObject({ status: 'published', version: 4, publishedAt: T1 })
    expect(await entryRow(env.DB, entryId)).toMatchObject({
      published_at: T1,
      published_sort_key: 'k9',
      updated_at: T4,
    })
  })

  it('refuses an unpublish that would be over the size of a row, and writes nothing', async () => {
    const { owner, entryId, store } = await seedPublished('unpublish-large')
    const before = await entryRow(env.DB, entryId)

    const answer = await store.unpublish(owner.site, {
      entryId,
      actor: { ...owner.actor, meta: { client: 'x'.repeat(1_950_000) } },
    })

    expect(answer).toMatchObject({ outcome: 'too_large', limit: 1_900_000 })
    expect(await entryRow(env.DB, entryId)).toEqual(before)
    expect(await publicationRows(entryId)).toHaveLength(1)
  })
})

describe('lastPublication', () => {
  async function insertPublication(
    owner: Owner,
    entryId: string,
    spec: {
      readonly id: string
      readonly action: 'publish' | 'unpublish'
      readonly revisionId: string | null
      readonly createdAt: string
      readonly actorMeta?: string | null
      readonly acknowledged?: string
    },
  ) {
    await env.DB.prepare(
      `INSERT INTO publications (id, site_id, entry_id, action, revision_id, verdict, acknowledged,
        actor_kind, actor_user_id, actor_token_id, actor_meta, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'token', ?8, ?9, ?10, ?11, ?11)`,
    )
      .bind(
        spec.id,
        owner.site,
        entryId,
        spec.action,
        spec.revisionId,
        spec.action === 'publish' ? JSON.stringify(PUBLISH_VERDICT) : null,
        spec.acknowledged ?? '[]',
        owner.actor.userId,
        owner.actor.tokenId,
        spec.actorMeta ?? null,
        spec.createdAt,
      )
      .run()
  }

  it('is null for an entry that was never published, and for one that is not there', async () => {
    const { owner, id, entryId, store } = await seedDraft('last-none')

    expect(await store.lastPublication(owner.site, entryId)).toBeNull()
    expect(await store.lastPublication(owner.site, id('ent_missing'))).toBeNull()
  })

  it('reads a publish with its verdict, the warnings acknowledged and its actor, and an unpublish with neither', async () => {
    const { owner, id, entryId, store } = await seedDraft('last-shape')
    await insertPublication(owner, entryId, {
      id: id('pub_1'),
      action: 'publish',
      revisionId: id('rev_a'),
      createdAt: T1,
      actorMeta: '{"client":"cursor"}',
      acknowledged: '[{"contract":"seo-title-length","path":"/frontmatter/title"}]',
    })
    expect(await store.lastPublication(owner.site, entryId)).toEqual({
      id: id('pub_1'),
      entryId,
      action: 'publish',
      revisionId: id('rev_a'),
      verdict: PUBLISH_VERDICT,
      acknowledged: ACKNOWLEDGED,
      actor: { ...owner.actor, meta: { client: 'cursor' } },
      createdAt: T1,
    })

    await insertPublication(owner, entryId, {
      id: id('pub_2'),
      action: 'unpublish',
      revisionId: null,
      createdAt: T2,
    })
    expect(await store.lastPublication(owner.site, entryId)).toEqual({
      id: id('pub_2'),
      entryId,
      action: 'unpublish',
      revisionId: null,
      verdict: null,
      acknowledged: [],
      actor: owner.actor,
      createdAt: T2,
    })
  })

  it('is the newest by time, whatever order the rows were written in, and the last written when two share a time', async () => {
    const { owner, id, entryId, store } = await seedDraft('last-order')
    const spec = (name: string, action: 'publish' | 'unpublish', createdAt: string) => ({
      id: id(name),
      action,
      revisionId: action === 'publish' ? id('rev_a') : null,
      createdAt,
    })
    // Written newest first: the row written last is not the newest one.
    await insertPublication(owner, entryId, spec('pub_3', 'unpublish', T3))
    await insertPublication(owner, entryId, spec('pub_1', 'publish', T1))
    await insertPublication(owner, entryId, spec('pub_2', 'publish', T2))
    expect((await store.lastPublication(owner.site, entryId))?.id).toBe(id('pub_3'))

    // Two at the same time: the one written after the other is the later one.
    await insertPublication(owner, entryId, spec('pub_4', 'publish', T4))
    await insertPublication(owner, entryId, spec('pub_0', 'unpublish', T4))
    expect((await store.lastPublication(owner.site, entryId))?.id).toBe(id('pub_0'))
  })
})
