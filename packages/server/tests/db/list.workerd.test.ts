import { HollwareError } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { encodeCursor } from '../../src/db/cursor.ts'
import { createD1Store } from '../../src/db/index.ts'
import type { ContentStore, ListQuery } from '../../src/ports.ts'
import {
  idFactory,
  insertEntries,
  recordStatements,
  seedOwner,
  siteKey,
  type EntrySpec,
} from './support.ts'

// Fails when: src/db/reads.ts listEntries stops ordering the head view by updated_at and then id
// (newest first) or the published view by published_sort_key and then id, loses the keyset
// predicate (the sort key, or the id that breaks a tie, or its direction: a page then repeats or
// skips an entry that shares its sort key with the last one of the previous page), stops asking for
// one more entry than the page to know whether there is a next page (a last page that is exactly
// full then has a cursor, or a page that is not the last has none), stops listing only published
// entries in the published view, filters by the tags of the wrong revision (the view's revision,
// not the head one), drops the locale, status or collection filter, accepts a limit that is not a
// whole number of at least 1, stops answering a summary of each revision (its id, frontmatter and
// tags) or lets a listing statement read another column of `revisions`, such as the Markdown, the
// document or the verdict, or src/db/cursor.ts stops refusing a cursor of another view.

const T1 = '2026-10-12T08:00:00.000Z'
const T2 = '2026-10-12T09:00:00.000Z'
const T3 = '2026-10-12T10:00:00.000Z'

/** The slugs of a page, in order. */
async function slugsOf(
  store: ContentStore,
  site: string,
  query: ListQuery,
): Promise<{ slugs: string[]; nextCursor: string | null }> {
  const page = await store.listEntries(site, query)
  return { slugs: page.entries.map((view) => view.entry.slug), nextCursor: page.nextCursor }
}

/** Every page of a listing, followed through its cursors, with the cursor each page gave. */
async function allPages(
  store: ContentStore,
  site: string,
  query: ListQuery,
): Promise<{ slugs: string[]; hasCursor: boolean }[]> {
  const pages: { slugs: string[]; hasCursor: boolean }[] = []
  let cursor: string | undefined
  do {
    const page = await slugsOf(store, site, {
      ...query,
      ...(cursor === undefined ? {} : { cursor }),
    })
    pages.push({ slugs: page.slugs, hasCursor: page.nextCursor !== null })
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined && pages.length < 20)
  return pages
}

/**
 * Seven entries whose updated_at is not in the order of their ids, written in no order at all:
 *   T3: 6, 4, 2   T2: 5, 1   T1: 7, 3
 * so that newest first, and ties by id descending, is 6 4 2 5 1 7 3.
 */
function headEntries(id: (name: string) => string): EntrySpec[] {
  const at: [string, string][] = [
    ['3', T1],
    ['6', T3],
    ['1', T2],
    ['7', T1],
    ['4', T3],
    ['2', T3],
    ['5', T2],
  ]
  return at.map(([name, updatedAt]) => ({
    id: id(`ent_${name}`),
    slug: `post-${name}`,
    updatedAt,
  }))
}

/**
 * Seven entries in the published view, whose updated_at has nothing to do with it:
 *   k3: 2, 4, 7   k2: 3, 5   k1: 1   and 6 is a draft
 * so that newest sort key first, and ties by id descending, is 7 4 2 5 3 1.
 */
function publishedEntries(id: (name: string) => string): EntrySpec[] {
  const spec = (name: string, updatedAt: string, sortKey: string | null): EntrySpec => ({
    id: id(`ent_${name}`),
    slug: `post-${name}`,
    updatedAt,
    revisions: [{ id: id(`rev_${name}`) }],
    ...(sortKey === null
      ? {}
      : { published: { revision: id(`rev_${name}`), sortKey, at: '2026-10-01T08:00:00.000Z' } }),
  })
  return [
    spec('1', T3, 'k1'),
    spec('2', T1, 'k3'),
    spec('3', T2, 'k2'),
    spec('4', T2, 'k3'),
    spec('5', T1, 'k2'),
    spec('6', T3, null),
    spec('7', T3, 'k3'),
  ]
}

describe('listEntries in the head view', () => {
  it('lists newest first by updated_at and then id, a page at a time, cutting through every tie', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-head'))
    await insertEntries(env.DB, owner, headEntries(idFactory()))
    const store = createD1Store(env.DB)
    const query: ListQuery = { collection: 'blog', view: 'head', limit: 2 }

    expect(await allPages(store, owner.site, query)).toEqual([
      { slugs: ['post-6', 'post-4'], hasCursor: true },
      { slugs: ['post-2', 'post-5'], hasCursor: true },
      { slugs: ['post-1', 'post-7'], hasCursor: true },
      { slugs: ['post-3'], hasCursor: false },
    ])
    expect(await allPages(store, owner.site, { ...query, limit: 3 })).toEqual([
      { slugs: ['post-6', 'post-4', 'post-2'], hasCursor: true },
      { slugs: ['post-5', 'post-1', 'post-7'], hasCursor: true },
      { slugs: ['post-3'], hasCursor: false },
    ])
  })

  it('has a next cursor only when there is more: a last page that is exactly full has none', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-full'))
    await insertEntries(env.DB, owner, headEntries(idFactory()))
    const store = createD1Store(env.DB)
    const query: ListQuery = { collection: 'blog', view: 'head', limit: 7 }

    expect(await allPages(store, owner.site, query)).toEqual([
      {
        slugs: ['post-6', 'post-4', 'post-2', 'post-5', 'post-1', 'post-7', 'post-3'],
        hasCursor: false,
      },
    ])
    expect(await allPages(store, owner.site, { ...query, limit: 100 })).toHaveLength(1)
    expect(await allPages(store, owner.site, { ...query, limit: 6 })).toEqual([
      { slugs: ['post-6', 'post-4', 'post-2', 'post-5', 'post-1', 'post-7'], hasCursor: true },
      { slugs: ['post-3'], hasCursor: false },
    ])
  })

  it('answers an empty page, with no cursor, for a collection without entries', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-empty'))
    await insertEntries(env.DB, owner, headEntries(idFactory()))
    const store = createD1Store(env.DB)

    expect(
      await slugsOf(store, owner.site, { collection: 'docs', view: 'head', limit: 10 }),
    ).toEqual({
      slugs: [],
      nextCursor: null,
    })
  })

  it('returns each entry with a summary of its head revision: the id, the frontmatter and the tags', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-shape'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        slug: 'a',
        translationGroup: 'g',
        updatedAt: T1,
        revisions: [
          {
            id: id('rev_a'),
            markdown: '# A',
            frontmatter: { title: 'A', nested: { list: [1, 2] } },
            tags: ['y', 'x'],
          },
        ],
      },
    ])
    const store = createD1Store(env.DB)

    const page = await store.listEntries(owner.site, { collection: 'blog', view: 'head', limit: 5 })

    // Equal to this and to nothing more: no Markdown, no document, no verdict, no actor.
    expect(page.entries).toEqual([
      {
        entry: {
          id: id('ent_a'),
          collection: 'blog',
          locale: 'en',
          slug: 'a',
          translationGroup: 'g',
          status: 'draft',
          version: 1,
          headRevision: id('rev_a'),
          publishedRevision: null,
          publishedAt: null,
          scheduledAt: null,
          deletedAt: null,
          updatedAt: T1,
        },
        revision: {
          id: id('rev_a'),
          frontmatter: { title: 'A', nested: { list: [1, 2] } },
          tags: ['x', 'y'],
          wordCount: 1,
          createdAt: T1,
        },
      },
    ])
  })
})

describe('listEntries in the published view', () => {
  it('lists only published entries, newest sort key first and then id, cutting through every tie', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-published'))
    await insertEntries(env.DB, owner, publishedEntries(idFactory()))
    const store = createD1Store(env.DB)
    const query: ListQuery = { collection: 'blog', view: 'published', limit: 2 }

    // The last page holds exactly `limit` entries and is the last: it has no cursor.
    expect(await allPages(store, owner.site, query)).toEqual([
      { slugs: ['post-7', 'post-4'], hasCursor: true },
      { slugs: ['post-2', 'post-5'], hasCursor: true },
      { slugs: ['post-3', 'post-1'], hasCursor: false },
    ])
    expect(await allPages(store, owner.site, { ...query, limit: 4 })).toEqual([
      { slugs: ['post-7', 'post-4', 'post-2', 'post-5'], hasCursor: true },
      { slugs: ['post-3', 'post-1'], hasCursor: false },
    ])
    // The head view of the same entries is ordered by something else, and lists the draft too.
    expect(
      await allPages(store, owner.site, { collection: 'blog', view: 'head', limit: 10 }),
    ).toEqual([
      {
        slugs: ['post-7', 'post-6', 'post-1', 'post-4', 'post-3', 'post-5', 'post-2'],
        hasCursor: false,
      },
    ])
  })

  it('lists each entry with its published revision, not its head one', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-live'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        slug: 'a',
        updatedAt: T3,
        revisions: [
          { id: id('rev_1'), frontmatter: { title: 'live' }, tags: ['news'] },
          { id: id('rev_2'), frontmatter: { title: 'newer draft' }, tags: ['wip'] },
        ],
        published: { revision: id('rev_1'), sortKey: 'k1', at: T1 },
      },
    ])
    const store = createD1Store(env.DB)

    const page = await store.listEntries(owner.site, {
      collection: 'blog',
      view: 'published',
      limit: 5,
    })

    expect(page.entries.map((view) => view.revision)).toEqual([
      {
        id: id('rev_1'),
        frontmatter: { title: 'live' },
        tags: ['news'],
        wordCount: 1,
        createdAt: T3,
      },
    ])
    expect(page.entries[0]?.entry.headRevision).toBe(id('rev_2'))
  })

  it('fails loudly on a published entry that has lost its sort key, which the checks of entries forbid, instead of skipping entries', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-corrupt'))
    const id = idFactory()
    const spec = (name: string): EntrySpec => ({
      id: id(`ent_${name}`),
      slug: `post-${name}`,
      updatedAt: T1,
      revisions: [{ id: id(`rev_${name}`) }],
      published: { revision: id(`rev_${name}`), sortKey: 'k', at: T1 },
    })
    await insertEntries(env.DB, owner, [spec('a'), spec('b')])
    // A database that was tampered with: the checks are off for one statement.
    await env.DB.batch([
      env.DB.prepare('PRAGMA ignore_check_constraints = ON'),
      env.DB.prepare('UPDATE entries SET published_sort_key = NULL WHERE site_id = ?').bind(
        owner.site,
      ),
      env.DB.prepare('PRAGMA ignore_check_constraints = OFF'),
    ])
    const store = createD1Store(env.DB)

    await expect(
      store.listEntries(owner.site, { collection: 'blog', view: 'published', limit: 1 }),
    ).rejects.toThrow(`The published entry ${id('ent_b')} has no published_sort_key`)
  })
})

describe('listEntries with filters', () => {
  /**
   * X: published at rev 1 (tag live), head rev 2 (tag wip).  Y: published, tags live and wip.
   * Z: a draft with the tag wip.  Q: an English entry of another collection with the tag live.
   * ES: a published entry in Spanish with the tag live.
   */
  async function seedFilters() {
    const owner = await seedOwner(env.DB, siteKey('list-filter'))
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_x'),
        slug: 'x',
        updatedAt: T1,
        revisions: [
          { id: id('rev_x1'), tags: ['live'] },
          { id: id('rev_x2'), tags: ['wip'] },
        ],
        published: { revision: id('rev_x1'), sortKey: 'k1', at: T1 },
      },
      {
        id: id('ent_y'),
        slug: 'y',
        updatedAt: T2,
        revisions: [{ id: id('rev_y'), tags: ['live', 'wip'] }],
        published: { revision: id('rev_y'), sortKey: 'k2', at: T1 },
      },
      {
        id: id('ent_z'),
        slug: 'z',
        updatedAt: T3,
        revisions: [{ id: id('rev_z'), tags: ['wip'] }],
      },
      {
        id: id('ent_q'),
        collection: 'docs',
        slug: 'q',
        updatedAt: T3,
        revisions: [{ id: id('rev_q'), tags: ['live'] }],
        published: { revision: id('rev_q'), sortKey: 'k9', at: T1 },
      },
      {
        id: id('ent_s'),
        locale: 'es',
        slug: 's',
        updatedAt: T2,
        revisions: [{ id: id('rev_s'), tags: ['live'] }],
        published: { revision: id('rev_s'), sortKey: 'k3', at: T1 },
      },
    ])
    return { owner, store: createD1Store(env.DB) }
  }

  it('filters by the tags of the revision of the view: the head one, or the published one', async () => {
    const { owner, store } = await seedFilters()
    const list = (view: ListQuery['view'], tag: string) =>
      slugsOf(store, owner.site, { collection: 'blog', view, tag, limit: 10 })

    // Head: x has only `wip` now; y has both; z is a draft with `wip`; s has `live`.
    expect((await list('head', 'live')).slugs).toEqual(['y', 's'])
    expect((await list('head', 'wip')).slugs).toEqual(['z', 'y', 'x'])
    // Published: x was published with `live`, whatever its head has since; z is not published.
    expect((await list('published', 'live')).slugs).toEqual(['s', 'y', 'x'])
    expect((await list('published', 'wip')).slugs).toEqual(['y'])
    expect((await list('published', 'nothing')).slugs).toEqual([])
  })

  it('filters by locale and by status, and a published listing has nothing but published entries', async () => {
    const { owner, store } = await seedFilters()
    const list = (query: Partial<ListQuery>) =>
      slugsOf(store, owner.site, { collection: 'blog', view: 'head', limit: 10, ...query })

    expect((await list({ locale: 'es' })).slugs).toEqual(['s'])
    expect((await list({ locale: 'en' })).slugs).toEqual(['z', 'y', 'x'])
    expect((await list({ locale: 'fr' })).slugs).toEqual([])
    expect((await list({ status: 'draft' })).slugs).toEqual(['z'])
    expect((await list({ status: 'published' })).slugs).toEqual(['y', 's', 'x'])
    expect((await list({ status: 'scheduled' })).slugs).toEqual([])
    expect((await list({ view: 'published', status: 'published' })).slugs).toEqual(['s', 'y', 'x'])
    expect(await list({ view: 'published', status: 'draft' })).toEqual({
      slugs: [],
      nextCursor: null,
    })
    expect((await list({ view: 'published', locale: 'es' })).slugs).toEqual(['s'])
  })

  it('keeps its filters across pages', async () => {
    const { owner, store } = await seedFilters()

    expect(
      await allPages(store, owner.site, {
        collection: 'blog',
        view: 'published',
        tag: 'live',
        limit: 1,
      }),
    ).toEqual([
      { slugs: ['s'], hasCursor: true },
      { slugs: ['y'], hasCursor: true },
      { slugs: ['x'], hasCursor: false },
    ])
  })
})

describe('listEntries with input it refuses', () => {
  const refusal = async (call: Promise<unknown>): Promise<HollwareError> => {
    try {
      await call
    } catch (error) {
      if (error instanceof HollwareError) return error
      throw error
    }
    throw new Error('The call did not fail')
  }

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses the limit %s as invalid_input, with a fix',
    async (limit) => {
      const owner = await seedOwner(env.DB, siteKey('list-limit'))
      const store = createD1Store(env.DB)

      const error = await refusal(
        store.listEntries(owner.site, { collection: 'blog', view: 'head', limit }),
      )

      expect(error.code).toBe('invalid_input')
      expect(error.message).toBe(`The limit ${limit} is not a whole number of at least 1.`)
      expect(error.fix).toBe('Ask for at least one entry per page.')
    },
  )

  it('refuses a cursor that no listing gave, and the cursor of the other view, as invalid_input', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-cursor'))
    await insertEntries(env.DB, owner, headEntries(idFactory()))
    const store = createD1Store(env.DB)
    const head = await store.listEntries(owner.site, { collection: 'blog', view: 'head', limit: 1 })

    const garbage = await refusal(
      store.listEntries(owner.site, {
        collection: 'blog',
        view: 'head',
        limit: 1,
        cursor: 'not a cursor',
      }),
    )
    const otherView = await refusal(
      store.listEntries(owner.site, {
        collection: 'blog',
        view: 'published',
        limit: 1,
        cursor: head.nextCursor ?? '',
      }),
    )

    expect(head.nextCursor).not.toBeNull()
    expect([garbage.code, otherView.code]).toEqual(['invalid_input', 'invalid_input'])
    expect(garbage.fix).toContain('nextCursor')
  })
})

/** The columns of `revisions` that a statement names, sorted and each once. */
function revisionColumns(statement: string): string[] {
  return [
    ...new Set([...statement.matchAll(/"revisions"\."(\w+)"/g)].map((match) => match[1] ?? '')),
  ]
    .filter((column) => column !== '')
    .toSorted()
}

/**
 * What every listing selects: the entry; the id, frontmatter, word count and date of the revision,
 * which the fields Hollware fills are made from; and its tags.
 */
const SELECT_A_SUMMARY = `select "entries"."id", "entries"."collection", "entries"."locale", "entries"."slug", "entries"."translation_group", "entries"."status", "entries"."version", "entries"."head_rev", "entries"."published_rev", "entries"."published_at", "entries"."scheduled_at", "entries"."deleted_at", "entries"."updated_at", "revisions"."id", "revisions"."frontmatter", "revisions"."word_count", "revisions"."created_at", (select json_group_array("revision_tags"."tag") from "revision_tags" where ("revision_tags"."revision_id" = "revisions"."id" and "revision_tags"."site_id" = "revisions"."site_id")), "entries"."published_sort_key"`

describe('the statements of a listing', () => {
  it('read the id, frontmatter, word count and date of a revision and no other column of it: never the Markdown, the document or the verdict', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-sql'))
    const { db, prepared } = recordStatements(env.DB)
    const store = createD1Store(db)
    const after = (view: ListQuery['view']) => encodeCursor(view, { key: 'k', id: 'ent_z' })
    const queries: ListQuery[] = [
      { collection: 'blog', view: 'head', limit: 10 },
      { collection: 'blog', view: 'head', limit: 10, locale: 'en', status: 'draft', tag: 'x' },
      { collection: 'blog', view: 'head', limit: 10, cursor: after('head') },
      { collection: 'blog', view: 'published', limit: 10 },
      { collection: 'blog', view: 'published', limit: 10, locale: 'en', tag: 'x' },
      {
        collection: 'blog',
        view: 'published',
        limit: 10,
        locale: 'en',
        cursor: after('published'),
      },
    ]

    for (const query of queries) await store.listEntries(owner.site, query)
    await store.listTranslations(owner.site, 'blog', 'g', 'head')
    await store.listTranslations(owner.site, 'blog', 'g', 'published')

    // One statement for each listing, and each reads the same columns of `revisions`: its id, its
    // frontmatter, its word count and its date, and its site, which joins it to its entry.
    expect(prepared).toHaveLength(queries.length + 2)
    expect(prepared.map(revisionColumns)).toEqual(
      Array(queries.length + 2).fill(['created_at', 'frontmatter', 'id', 'site_id', 'word_count']),
    )
  })

  it('are these two, for the head view with a locale after a cursor and for the published view of a locale', async () => {
    const owner = await seedOwner(env.DB, siteKey('list-pin'))
    const { db, prepared } = recordStatements(env.DB)
    const store = createD1Store(db)

    await store.listEntries(owner.site, {
      collection: 'blog',
      view: 'head',
      limit: 20,
      locale: 'en',
      cursor: encodeCursor('head', { key: T2, id: 'ent_z' }),
    })
    await store.listEntries(owner.site, {
      collection: 'blog',
      view: 'published',
      limit: 20,
      locale: 'en',
    })

    // The cursor is a row value, which an index seeks to; and the status of the published view is
    // a literal, which the partial index needs.
    expect(prepared).toEqual([
      `${SELECT_A_SUMMARY} from "entries" inner join "revisions" on ("revisions"."id" = "entries"."head_rev" and "revisions"."site_id" = "entries"."site_id") where ("entries"."site_id" = ? and "entries"."collection" = ? and "entries"."locale" = ? and ("entries"."updated_at", "entries"."id") < (?, ?) and "entries"."deleted_at" is null) order by "entries"."updated_at" desc, "entries"."id" desc limit ?`,
      `${SELECT_A_SUMMARY} from "entries" inner join "revisions" on ("revisions"."id" = "entries"."published_rev" and "revisions"."site_id" = "entries"."site_id") where ("entries"."site_id" = ? and "entries"."collection" = ? and "entries"."locale" = ? and "entries"."status" = 'published') order by "entries"."published_sort_key" desc, "entries"."id" desc limit ?`,
    ])
  })
})
