import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { newId } from '@hollware/core'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { createD1Store } from '../../src/db/index.ts'
import type { Actor } from '../../src/ports.ts'
import { fixedClock, insertEntries } from '../db/support.ts'
import { seedSite, type SeededEntry, type SeededSite } from '../support/sites.ts'
import { agent, BINDING, blogPost, contextFor, tenantOf, warmUpComark } from './support.ts'
import { snapshotOf, START } from './world.ts'

// Fails when: a handler stops asking the store for the site of its context, in any call it makes
// (AC-0.1-13). With the rows of a second site in the database, which has the same natural keys
// as the first, an operation run as one site then finds, lists, changes, publishes, takes down or
// counts the other's rows: list-entries.ts, get-entry.ts, get-translations.ts, create-draft.ts,
// update-draft.ts, publish.ts, unpublish.ts and validate.ts pass `context.site.key` to the store,
// and draft.ts passes it to the lookup that the contracts read other entries through. Each test
// runs as both sites, so that whichever one was written first cannot hide a call that forgets it.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

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

/** The key of an entry that only the other site has. */
const ONLY_THERE = { collection: 'blog', locale: 'en', slug: 'only-in-the-other-site' }

/**
 * Writes the rows that only a site has, straight into D1, so that what the operations answer for
 * the caller does not depend on the handlers that the test is about to break: an English entry
 * of a translation group and a tag that the caller's site does not have, published, and its
 * Spanish translation, a draft. Gives the id of the English one.
 */
async function seedForeign(site: SeededSite): Promise<string> {
  const actor: Actor = { kind: 'token', userId: site.userId, tokenId: site.tokenId, meta: null }
  const english = { entry: newId('ent'), revision: newId('rev') }
  const now = '2026-10-13T10:00:00.000Z'
  await insertEntries(env.DB, { site: site.site, actor }, [
    {
      id: english.entry,
      slug: ONLY_THERE.slug,
      locale: 'en',
      translationGroup: 'only-there',
      updatedAt: now,
      revisions: [{ id: english.revision, tags: ['only-there-tag'] }],
      published: { revision: english.revision, sortKey: now, at: now },
    },
    {
      id: newId('ent'),
      slug: 'solo-en-el-otro-sitio',
      locale: 'es',
      translationGroup: 'only-there',
      updatedAt: now,
      revisions: [{ id: newId('rev') }],
    },
  ])
  return english.entry
}

/**
 * Two seeded sites with the same natural keys, and the calls of the one that is the `caller`.
 * The other site also has the rows of `seedForeign`.
 */
async function seedPair(callerIs: 'home' | 'stranger') {
  const suffix = crypto.randomUUID()
  const home = await seedSite(env.DB, `home-${suffix}`)
  const stranger = await seedSite(env.DB, `stranger-${suffix}`)
  const [mine, theirs] = callerIs === 'home' ? [home, stranger] : [stranger, home]
  const time = fixedClock(START)
  const store = createD1Store(env.DB, { clock: time.clock })
  const options = { clock: time.clock }
  const callerTenant = tenantOf(mine.site, mine.userId, mine.tokenId)
  const otherTenant = tenantOf(theirs.site, theirs.userId, theirs.tokenId)
  const otherOnly = await seedForeign(theirs)

  return {
    caller: agent(contextFor(callerTenant, store, options)),
    reader: agent(
      contextFor(callerTenant, store, { ...options, view: 'published', principal: BINDING }),
    ),
    mine: entriesOf(mine),
    theirs: entriesOf(theirs),
    callerSite: mine.site,
    otherSite: theirs.site,
    otherOnly,
    otherAgent: agent(contextFor(otherTenant, store, options)),
  }
}

describe.each(['home', 'stranger'] as const)(
  'with the rows of a second site, as the %s site',
  (callerIs) => {
    it('describes its own site', async () => {
      const { caller, callerSite } = await seedPair(callerIs)

      expect((await caller.describeSite()).site.key).toBe(callerSite)
    })

    it('lists, in both views, only its own entries, and by tag, locale and page', async () => {
      const { caller, reader, mine, otherAgent } = await seedPair(callerIs)

      const head = await caller.listEntries({ collection: 'blog' })
      const published = await reader.listEntries({ collection: 'blog' })
      const tagged = await caller.listEntries({ collection: 'blog', tag: 'cms' })
      const spanish = await reader.listEntries({ collection: 'blog', locale: 'es' })
      // A page of exactly the two published entries is the last: the other site's do not make a next one.
      const exact = await reader.listEntries({ collection: 'blog', limit: 2 })
      // A tag that only the other site has lists nothing here, and does list its entry there.
      const foreignTag = await caller.listEntries({ collection: 'blog', tag: 'only-there-tag' })
      const foreignTagLive = await reader.listEntries({ collection: 'blog', tag: 'only-there-tag' })
      const theirTag = await otherAgent.listEntries({ collection: 'blog', tag: 'only-there-tag' })

      const ids = (page: { entries: { id: string }[] }) =>
        page.entries.map((entry) => entry.id).toSorted()
      expect(ids(head)).toEqual([mine.english.id, mine.spanish.id, mine.draft.id].toSorted())
      expect(ids(published)).toEqual([mine.english.id, mine.spanish.id].toSorted())
      expect(ids(tagged)).toEqual([mine.english.id, mine.spanish.id, mine.draft.id].toSorted())
      expect(ids(spanish)).toEqual([mine.spanish.id])
      expect([head.nextCursor, published.nextCursor, exact.nextCursor]).toEqual([null, null, null])
      expect(exact.entries).toHaveLength(2)
      expect(foreignTag).toEqual({ outcome: 'ok', entries: [], nextCursor: null })
      expect(foreignTagLive).toEqual({ outcome: 'ok', entries: [], nextCursor: null })
      expect(theirTag.entries.map((entry) => entry.slug)).toEqual(['only-in-the-other-site'])
    })

    it('finds its own entry by its key, and no entry that only the other site has', async () => {
      const { caller, reader, mine } = await seedPair(callerIs)
      const key = (entry: SeededEntry) => ({
        collection: entry.collection,
        locale: entry.locale,
        slug: entry.slug,
      })

      const own = await caller.getEntry(key(mine.english))
      const ownLive = await reader.getEntry(key(mine.english))
      const foreign = await caller.getEntry(ONLY_THERE)
      const foreignLive = await reader.getEntry(ONLY_THERE)

      expect(own.entry?.id).toBe(mine.english.id)
      expect(ownLive.entry?.id).toBe(mine.english.id)
      // The entry has a publication in its own site, and none here.
      expect(own.entry?.lastPublication?.revision).toBe(mine.english.revisionId)
      expect(foreign).toEqual({ outcome: 'not_found' })
      expect(foreignLive).toEqual({ outcome: 'not_found' })
    })

    it('gives the translations of its own group, and none for a group that only the other site has', async () => {
      const { caller, reader, mine } = await seedPair(callerIs)

      const own = await caller.getTranslations({
        collection: 'blog',
        translationGroup: 'edge-caching',
      })
      const live = await reader.getTranslations({
        collection: 'blog',
        translationGroup: 'edge-caching',
      })
      const foreign = await caller.getTranslations({
        collection: 'blog',
        translationGroup: 'only-there',
      })

      expect(own.entries?.map((entry) => entry.id)).toEqual([mine.english.id, mine.spanish.id])
      expect(live.entries?.map((entry) => entry.id)).toEqual([mine.english.id, mine.spanish.id])
      expect(foreign).toEqual({ outcome: 'not_found' })
    })

    it('creates an entry under a key that only the other site has, and is refused only by its own entries', async () => {
      const { caller, mine, otherSite } = await seedPair(callerIs)
      const before = await snapshotOf(env.DB, otherSite)
      const create = (slug: string, locale: string, group: string) =>
        caller.createDraft({
          collection: 'blog',
          locale,
          slug,
          markdown: blogPost({ translationGroup: group }),
        })

      // The slug and the translation of the other site's entry are free here.
      const sameSlug = await create(ONLY_THERE.slug, 'en', 'a-group-of-its-own')
      const sameGroup = await create('another-slug', 'en', 'only-there')
      // The ones its own entries hold are not.
      const slugTaken = await create(mine.english.slug, 'en', 'a-group-of-its-own')
      const groupTaken = await create('a-third-slug', 'en', 'edge-caching')

      expect([sameSlug.outcome, sameGroup.outcome]).toEqual(['saved', 'saved'])
      expect(slugTaken.verdict?.errors).toEqual([
        expect.objectContaining({
          contract: 'unique-slug',
          message: `Another entry of this collection and locale, ${mine.english.id}, already has this slug.`,
        }),
      ])
      expect(groupTaken.verdict?.errors).toEqual([
        expect.objectContaining({
          contract: 'unique-translation',
          message: `Another entry of this collection and locale, ${mine.english.id}, already belongs to this translation group.`,
        }),
      ])
      expect(await snapshotOf(env.DB, otherSite)).toEqual(before)
    })

    it('answers not_found to a change of an entry of the other site, and changes nothing there', async () => {
      const { caller, mine, theirs, otherOnly, otherSite } = await seedPair(callerIs)
      const before = await snapshotOf(env.DB, otherSite)
      const markdown = contentFixture('blog/en/from-draft-to-published.md')
      const foreign = [theirs.english.id, theirs.spanish.id, theirs.draft.id, otherOnly]

      for (const id of foreign) {
        expect(
          await caller.updateDraft({ id, version: 1, markdown: `${markdown}\nMore text.\n` }),
        ).toEqual({
          outcome: 'not_found',
        })
        expect(await caller.updateDraft({ id, version: 1, markdown })).toEqual({
          outcome: 'not_found',
        })
        expect(await caller.publish({ id, version: 1 })).toEqual({ outcome: 'not_found' })
        expect(await caller.unpublish({ id })).toEqual({ outcome: 'not_found' })
      }

      expect(await snapshotOf(env.DB, otherSite)).toEqual(before)
      // The same calls for its own entries do answer.
      expect((await caller.updateDraft({ id: mine.draft.id, version: 1, markdown })).outcome).toBe(
        'unchanged',
      )
      expect((await caller.unpublish({ id: mine.english.id })).outcome).toBe('unpublished')
      expect(await snapshotOf(env.DB, otherSite)).toEqual(before)
    })

    it('writes and publishes its own entries under keys that the other site has too, and leaves the other site as it was', async () => {
      const { caller, reader, mine, otherSite } = await seedPair(callerIs)
      const before = await snapshotOf(env.DB, otherSite)
      const english = contentFixture('blog/en/from-draft-to-published.md')

      // Its draft gets its Spanish translation and a change, and is published.
      const sibling = await caller.createDraft({
        collection: 'blog',
        locale: 'es',
        slug: 'del-borrador-a-publicado',
        markdown: contentFixture('blog/es/del-borrador-a-publicado.md'),
      })
      const edited = await caller.updateDraft({
        id: mine.draft.id,
        version: 1,
        markdown: `${english}\nMore text.\n`,
      })
      const published = await caller.publish({ id: mine.draft.id, version: 2 })

      expect([sibling.outcome, edited.outcome, published.outcome]).toEqual([
        'saved',
        'saved',
        'published',
      ])
      expect(published.entry).toMatchObject({ id: mine.draft.id, version: 3, status: 'published' })
      const live = await reader.getEntry({
        collection: 'blog',
        locale: 'en',
        slug: 'from-draft-to-published',
      })
      expect(live.entry?.id).toBe(mine.draft.id)
      expect(await snapshotOf(env.DB, otherSite)).toEqual(before)
    })

    it('takes down only its own entries: the ones of the other site stay published', async () => {
      const { caller, reader, mine, otherAgent } = await seedPair(callerIs)

      await caller.unpublish({ id: mine.english.id })
      await caller.unpublish({ id: mine.spanish.id })

      expect((await reader.listEntries({ collection: 'blog' })).entries).toEqual([])
      const theirs = await otherAgent.getTranslations({
        collection: 'blog',
        translationGroup: 'edge-caching',
      })
      expect(theirs.entries?.map((entry) => entry.status)).toEqual(['published', 'published'])
    })

    it('checks a file against its own entries: the links and the translations of the other site do not count', async () => {
      const { caller, mine } = await seedPair(callerIs)
      const checks = async (group: string, locale: string, body: string) =>
        (
          await caller.validate({
            collection: 'blog',
            locale,
            slug: 'a-post-to-check',
            markdown: blogPost({ translationGroup: group }, body),
          })
        ).verdict.errors.map((error) => [error.contract, error.message])

      // A link to its own published entry resolves; one to an entry that only the other site has does not.
      const own = await checks('guide', 'en', '\nSee [a post](/en/blog/edge-caching-basics/).\n')
      const foreign = await checks(
        'guide',
        'en',
        '\nSee [a post](/en/blog/only-in-the-other-site/).\n',
      )
      // A group whose pair is in its own site is complete; one whose pair is only in the other site is not.
      const pairOwn = await checks('edge-caching', 'es', '\nText.\n')
      const pairForeign = await checks('only-there', 'es', '\nText.\n')

      expect(mine.english.slug).toBe('edge-caching-basics')
      expect(own).toEqual([
        ['translation-pair', 'The es version of the translation group "guide" does not exist.'],
      ])
      expect(foreign).toEqual([
        ['translation-pair', 'The es version of the translation group "guide" does not exist.'],
        [
          'internal-links-resolve',
          'The link "/en/blog/only-in-the-other-site/" points at the entry blog/en/only-in-the-other-site, which does not exist.',
        ],
      ])
      expect(pairOwn).toEqual([])
      expect(pairForeign).toEqual([
        [
          'translation-pair',
          'The en version of the translation group "only-there" does not exist.',
        ],
      ])
    })
  },
)
