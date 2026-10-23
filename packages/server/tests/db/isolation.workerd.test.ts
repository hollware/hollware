import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import type { Actor } from '../../src/ports.ts'
import { seedSite, type SeededEntry, type SeededSite } from '../support/sites.ts'
import { fixedClock, newRevision } from './support.ts'

// Fails when: any method of the store stops carrying `site_id` in a query of its own (the reads
// by key and by id, listing, translations, lookups, the last publication, the holder of a slug or
// a translation, and the reads that tell `conflict` from `not_found`), or in a write (the revision,
// the publication and the entry's update): with the rows of a second site in the database, which
// has the same natural keys, a call for one site then sees, changes or counts the other's rows.
// Each test runs for both sites as the caller, so that whichever site was written first cannot
// hide a query that forgets the site.

const NOW = '2026-10-12T10:00:00.000Z'

/** The seeded entries of a site: two published (en, es) in one translation group, and a draft. */
interface Entries {
  readonly english: SeededEntry
  readonly spanish: SeededEntry
  readonly draft: SeededEntry
}

function entriesOf(site: SeededSite): Entries {
  const [english, spanish, draft] = site.entries
  if (english === undefined || spanish === undefined || draft === undefined) {
    throw new Error('seedSite no longer seeds three entries')
  }
  return { english, spanish, draft }
}

const refOf = (entry: SeededEntry) => ({
  collection: entry.collection,
  locale: entry.locale,
  slug: entry.slug,
})

const actorOf = (site: SeededSite): Actor => ({
  kind: 'token',
  userId: site.userId,
  tokenId: site.tokenId,
  meta: null,
})

/** Two seeded sites with the same natural keys; the `caller` is the one the calls are made for. */
async function seedPair(callerIs: 'home' | 'stranger') {
  const suffix = crypto.randomUUID()
  const home = await seedSite(env.DB, `home-${suffix}`)
  const stranger = await seedSite(env.DB, `stranger-${suffix}`)
  const [caller, other] = callerIs === 'home' ? [home, stranger] : [stranger, home]
  return {
    caller,
    other,
    mine: entriesOf(caller),
    theirs: entriesOf(other),
    store: createD1Store(env.DB, { clock: fixedClock(NOW).clock }),
  }
}

/** Everything a site has in the database that a write could change. */
async function snapshot(site: string) {
  const { results: entries } = await env.DB.prepare(
    `SELECT id, status, version, head_rev, published_rev, published_at, published_sort_key,
        translation_group, updated_at FROM entries WHERE site_id = ? ORDER BY id`,
  )
    .bind(site)
    .all()
  const counts: Record<string, number | null> = {}
  for (const table of ['revisions', 'revision_tags', 'publications']) {
    counts[table] = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id = ?`)
      .bind(site)
      .first<number>('n')
  }
  return { entries, counts }
}

describe.each(['home', 'stranger'] as const)(
  'with the rows of a second site, calling for the %s site',
  (callerIs) => {
    it('finds an entry by its key in its own site, in both views', async () => {
      const { caller, mine, store } = await seedPair(callerIs)

      for (const view of ['head', 'published'] as const) {
        const english = await store.findEntry(caller.site, refOf(mine.english), view)
        const spanish = await store.findEntry(caller.site, refOf(mine.spanish), view)
        expect([english?.entry.id, english?.revision.id]).toEqual([
          mine.english.id,
          mine.english.revisionId,
        ])
        expect([spanish?.entry.id, spanish?.revision.id]).toEqual([
          mine.spanish.id,
          mine.spanish.revisionId,
        ])
      }
      expect((await store.findEntry(caller.site, refOf(mine.draft), 'head'))?.entry.id).toBe(
        mine.draft.id,
      )
      expect(await store.findEntry(caller.site, refOf(mine.draft), 'published')).toBeNull()
    })

    it('finds no entry by the id of an entry of the other site', async () => {
      const { caller, mine, theirs, store } = await seedPair(callerIs)

      for (const view of ['head', 'published'] as const) {
        for (const entry of Object.values(theirs)) {
          expect(await store.findEntryById(caller.site, entry.id, view)).toBeNull()
        }
      }
      expect((await store.findEntryById(caller.site, mine.english.id, 'published'))?.entry.id).toBe(
        mine.english.id,
      )
    })

    it('never shows a revision of another site, even to an entry that points at one', async () => {
      const { caller, mine, theirs, store } = await seedPair(callerIs)
      // `head_rev` and `published_rev` have no foreign key, so a bug could point one at another site.
      await env.DB.prepare('UPDATE entries SET head_rev = ?, published_rev = ? WHERE id = ?')
        .bind(theirs.english.revisionId, theirs.english.revisionId, mine.english.id)
        .run()

      expect(await store.findEntry(caller.site, refOf(mine.english), 'head')).toBeNull()
      expect(await store.findEntryById(caller.site, mine.english.id, 'published')).toBeNull()
      const page = await store.listEntries(caller.site, {
        collection: 'blog',
        view: 'head',
        limit: 10,
      })
      expect(page.entries.map((view) => view.entry.id).toSorted()).toEqual(
        [mine.spanish.id, mine.draft.id].toSorted(),
      )
    })

    it('finds no revision and no review of the other site by its id', async () => {
      const { caller, other, mine, theirs, store } = await seedPair(callerIs)
      const review = (site: SeededSite, entry: SeededEntry) => {
        const id = `rvw_${crypto.randomUUID()}`
        return env.DB.prepare(
          `INSERT INTO reviews (id, site_id, entry_id, revision_id, status, acknowledged,
            requested_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'pending', '[]', ?5, ?6, ?6)`,
        )
          .bind(id, site.site, entry.id, entry.revisionId, site.userId, NOW)
          .run()
          .then(() => id)
      }
      const own = await review(caller, mine.draft)
      const foreign = await review(other, theirs.draft)

      expect(await store.findRevision(caller.site, theirs.english.revisionId)).toBeNull()
      expect((await store.findRevision(caller.site, mine.english.revisionId))?.id).toBe(
        mine.english.revisionId,
      )
      expect(await store.findReview(caller.site, foreign)).toBeNull()
      expect((await store.findReview(caller.site, own))?.id).toBe(own)
    })

    it('lists, and counts for the next page, only its own entries', async () => {
      const { caller, mine, store } = await seedPair(callerIs)
      const list = (query: {
        view: 'head' | 'published'
        limit: number
        tag?: string
        cursor?: string
      }) => store.listEntries(caller.site, { collection: 'blog', ...query })

      const head = await list({ view: 'head', limit: 100 })
      const published = await list({ view: 'published', limit: 100 })
      const tagged = await list({ view: 'head', limit: 100, tag: 'cms' })
      // A page of exactly two published entries is the last: the other site's two do not make a next one.
      const exact = await list({ view: 'published', limit: 2 })

      expect(head.entries.map((view) => view.entry.id).toSorted()).toEqual(
        [mine.english.id, mine.spanish.id, mine.draft.id].toSorted(),
      )
      expect(published.entries.map((view) => view.entry.id).toSorted()).toEqual(
        [mine.english.id, mine.spanish.id].toSorted(),
      )
      expect(tagged.entries).toHaveLength(3)
      expect([head.nextCursor, published.nextCursor, tagged.nextCursor, exact.nextCursor]).toEqual([
        null,
        null,
        null,
        null,
      ])
      expect(exact.entries).toHaveLength(2)
      // One at a time, the second page is the other published entry of this site, and the last.
      const first = await list({ view: 'published', limit: 1 })
      const second = await list({ view: 'published', limit: 1, cursor: first.nextCursor ?? '' })
      expect([first.entries.length, second.entries.length, second.nextCursor]).toEqual([1, 1, null])
      expect([...first.entries, ...second.entries].map((view) => view.entry.id).toSorted()).toEqual(
        [mine.english.id, mine.spanish.id].toSorted(),
      )
    })

    it('lists the translations of a group from its own site', async () => {
      const { caller, mine, store } = await seedPair(callerIs)

      for (const view of ['head', 'published'] as const) {
        const group = await store.listTranslations(caller.site, 'blog', 'edge-caching', view)
        expect(group.map((entry) => entry.entry.id)).toEqual([mine.english.id, mine.spanish.id])
      }
      const drafts = await store.listTranslations(caller.site, 'blog', 'publishing-flow', 'head')
      expect(drafts.map((entry) => entry.entry.id)).toEqual([mine.draft.id])
      expect(
        await store.listTranslations(caller.site, 'blog', 'publishing-flow', 'published'),
      ).toEqual([])
    })

    it('looks up entries and translations in its own site, and finds nothing for a key only the other has', async () => {
      const { caller, other, mine, store } = await seedPair(callerIs)
      // An entry that exists in the other site only.
      const onlyThere = { collection: 'blog', locale: 'en', slug: 'only-in-the-other-site' }
      const made = await store.createEntry(other.site, {
        ...onlyThere,
        translationGroup: null,
        revision: newRevision(actorOf(other)),
      })
      expect(made.outcome).toBe('saved')
      const lookup = store.lookup(caller.site)

      const facts = await lookup.lookupMany([
        refOf(mine.draft),
        refOf(mine.english),
        onlyThere,
        refOf(mine.spanish),
      ])
      const group = await lookup.translations('blog', 'edge-caching')

      expect(facts.map((fact) => fact?.id ?? null)).toEqual([
        mine.draft.id,
        mine.english.id,
        null,
        mine.spanish.id,
      ])
      expect(group.map((entry) => entry.id)).toEqual([mine.english.id, mine.spanish.id])
    })

    it('reads the last publication of its own entries only', async () => {
      const { caller, mine, theirs, store } = await seedPair(callerIs)

      expect(await store.lastPublication(caller.site, theirs.english.id)).toBeNull()
      expect(await store.lastPublication(caller.site, theirs.draft.id)).toBeNull()
      const own = await store.lastPublication(caller.site, mine.english.id)
      expect([own?.entryId, own?.revisionId, own?.actor.userId]).toEqual([
        mine.english.id,
        mine.english.revisionId,
        caller.userId,
      ])
    })
  },
)

describe.each(['home', 'stranger'] as const)(
  'with the rows of a second site, writing for the %s site',
  (callerIs) => {
    it('creates an entry the other site has under the same key, and answers taken only by its own entries', async () => {
      const { caller, other, mine, store } = await seedPair(callerIs)
      const before = await snapshot(other.site)
      const actor = actorOf(caller)

      const slugTaken = await store.createEntry(caller.site, {
        ...refOf(mine.english),
        translationGroup: null,
        revision: newRevision(actor),
      })
      const translationTaken = await store.createEntry(caller.site, {
        collection: 'blog',
        locale: 'en',
        slug: 'a-new-slug',
        translationGroup: 'edge-caching',
        revision: newRevision(actor),
      })
      const free = await store.createEntry(caller.site, {
        collection: 'blog',
        locale: 'pt',
        slug: 'cache-na-borda',
        translationGroup: 'edge-caching',
        revision: newRevision(actor, { tags: ['cms'] }),
      })

      expect(slugTaken).toEqual({ outcome: 'taken', field: 'slug', by: mine.english.id })
      expect(translationTaken).toEqual({
        outcome: 'taken',
        field: 'translationGroup',
        by: mine.english.id,
      })
      expect(free.outcome).toBe('saved')
      expect(await snapshot(other.site)).toEqual(before)
    })

    it('answers not_found to a revision for an entry of the other site, and changes nothing there', async () => {
      const { caller, other, mine, theirs, store } = await seedPair(callerIs)
      const before = await snapshot(other.site)
      const actor = actorOf(caller)
      const write = (entryId: string) =>
        store.appendRevision(caller.site, {
          entryId,
          expectedVersion: 1,
          translationGroup: null,
          revision: newRevision(actor, {
            markdown: 'from the wrong site',
            tags: ['wrong', 'site'],
          }),
        })

      const answers = [
        await write(theirs.draft.id),
        await write(theirs.english.id),
        await write(theirs.spanish.id),
      ]

      expect(answers).toEqual([
        { outcome: 'not_found' },
        { outcome: 'not_found' },
        { outcome: 'not_found' },
      ])
      expect(await snapshot(other.site)).toEqual(before)
      // The same write for its own entry lands, and still touches nothing of the other site.
      expect((await write(mine.draft.id)).outcome).toBe('saved')
      expect(await snapshot(other.site)).toEqual(before)
    })

    it('answers taken by an entry of its own site when a revision asks for a translation both sites have', async () => {
      const { caller, mine, store } = await seedPair(callerIs)

      // The draft is an English entry; `edge-caching` already has an English one, here and there.
      const answer = await store.appendRevision(caller.site, {
        entryId: mine.draft.id,
        expectedVersion: 1,
        translationGroup: 'edge-caching',
        revision: newRevision(actorOf(caller)),
      })

      expect(answer).toEqual({ outcome: 'taken', field: 'translationGroup', by: mine.english.id })
    })

    it('answers not_found to a publish of an entry of the other site, and publishes nothing there', async () => {
      const { caller, other, mine, theirs, store } = await seedPair(callerIs)
      const before = await snapshot(other.site)
      const publish = (entryId: string) =>
        store.publish(caller.site, {
          entryId,
          expectedVersion: 1,
          verdict: { ok: true, phase: 'publish', errors: [], warnings: [], contractsHash: 'h' },
          acknowledged: [],
          actor: actorOf(caller),
          sortKey: 'k',
        })

      const answers = [await publish(theirs.draft.id), await publish(theirs.english.id)]

      expect(answers).toEqual([{ outcome: 'not_found' }, { outcome: 'not_found' }])
      expect(await snapshot(other.site)).toEqual(before)
      expect((await publish(mine.draft.id)).outcome).toBe('published')
      expect(await snapshot(other.site)).toEqual(before)
    })

    it('answers not_found to an unpublish of an entry of the other site, and takes nothing off there', async () => {
      const { caller, other, mine, theirs, store } = await seedPair(callerIs)
      const before = await snapshot(other.site)
      const unpublish = (entryId: string) =>
        store.unpublish(caller.site, { entryId, actor: actorOf(caller) })

      const answers = [
        await unpublish(theirs.english.id),
        await unpublish(theirs.spanish.id),
        await unpublish(theirs.draft.id),
      ]

      expect(answers).toEqual([
        { outcome: 'not_found' },
        { outcome: 'not_found' },
        { outcome: 'not_found' },
      ])
      expect(await snapshot(other.site)).toEqual(before)
      // Its own published entry does come off, and the other site's stay published.
      expect((await unpublish(mine.english.id)).outcome).toBe('unpublished')
      expect(await snapshot(other.site)).toEqual(before)
      expect(
        (await store.findEntryById(other.site, theirs.english.id, 'published'))?.entry.id,
      ).toBe(theirs.english.id)
    })
  },
)
