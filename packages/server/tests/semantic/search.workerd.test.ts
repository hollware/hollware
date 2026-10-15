import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { connect } from '../../src/db/d1.ts'
import type { Semantic } from '../../src/ports.ts'
import { syncEntryVectors } from '../../src/semantic/index-entry.ts'
import { agent, BINDING, blogPost, warmUpComark } from '../ops/support.ts'
import { newWorld, type World } from '../ops/world.ts'
import { fakeSemantic } from './fakes.ts'

// Fails when: the operation `search` (src/ops/search.ts, src/ops/semantic-search.ts) stops finding
// by meaning what full text cannot, answering the excerpt of an entry's closest piece, leaving out
// an entry unpublished since its vectors were made, or narrowing the index to a locale; stops
// merging both in hybrid, where the words found by full text keep their snippet; or stops saying
// in `mode` that the search was full text when the deployment has no semantic search; or get_entry
// (src/ops/get-entry.ts) stops answering, only when asked, the published entries the vectors found
// closest when the entry was indexed (src/semantic/index-entry.ts), closest first and never itself.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

/**
 * The fake model counts letters, so posts are written for their letters: "jazz" and "buzz" are
 * near each other and far from "moon". A post's summary is its title, its description (the title
 * again) and its text.
 */
const POSTS = {
  jazz: { title: 'Jazz', body: '\nJazz quizzes, a jazzy prize.\n' },
  buzz: { title: 'Buzz', body: '\nBuzz, fuzz and a quiz.\n' },
  moon: { title: 'Moon', body: '\nMoon on the moor, a moody noon.\n' },
  // A summary far from "jazz", and a section near it.
  notes: {
    title: 'Notes',
    body: '\nMoon on the moor.\n\n## Jazz\n\nJazz quizzes, a jazzy prize.\n',
  },
} as const

async function publish(world: World, slug: keyof typeof POSTS): Promise<string> {
  const { title, body } = POSTS[slug]
  const markdown = (group: string) =>
    blogPost({ title, description: title, translationGroup: group }, body)
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: markdown(slug),
  })
  if (created.entry === undefined) throw new Error(JSON.stringify(created))
  // The blog publishes a post only with its translation.
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'es',
    slug: `${slug}-es`,
    markdown: markdown(slug),
  })
  const published = await world.agent.publish({ id: created.entry.id, version: 1 })
  if (published.outcome !== 'published') throw new Error(JSON.stringify(published))
  return created.entry.id
}

/** Publishes the posts and indexes them in this order, and gives a site's reader of them. */
async function indexed(label: string, slugs: readonly (keyof typeof POSTS)[]) {
  const world = await newWorld(env.DB, label)
  const { semantic } = fakeSemantic()
  const ids: Record<string, string> = {}
  for (const slug of slugs) ids[slug] = await publish(world, slug)
  for (const slug of slugs) {
    await syncEntryVectors(connect(world.db), semantic, {
      site: world.tenant.key,
      entryId: ids[slug] ?? '',
      now: '2026-10-15T12:00:00.000Z',
    })
  }
  const reader = (with_: Semantic | null) =>
    agent({ ...world.context({ view: 'published', principal: BINDING }), semantic: with_ })
  return { world, ids, semantic, reader }
}

const slugsOf = (answer: { results: readonly { entry: { slug: string } }[] }) =>
  answer.results.map((result) => result.entry.slug)

describe('search by meaning', () => {
  it('finds what full text cannot, with the start of the closest piece', async () => {
    const { reader, semantic } = await indexed('semantic-find', ['moon', 'jazz'])
    const site = reader(semantic)

    const meaning = await site.search({ query: 'fizz buzz jazz', mode: 'semantic' })
    const words = await site.search({ query: 'fizz buzz jazz', mode: 'fulltext' })

    expect(meaning.mode).toBe('semantic')
    expect(slugsOf(meaning)).toEqual(['jazz', 'moon'])
    expect(meaning.results[0]?.snippet).toBe('Jazz Jazz Jazz quizzes, a jazzy prize.')
    expect([words.mode, slugsOf(words)]).toEqual(['fulltext', []])
  })

  it('counts an entry once, by its closest piece', async () => {
    const { reader, semantic } = await indexed('semantic-pieces', ['notes'])

    const answer = await reader(semantic).search({ query: 'jazz quiz', mode: 'semantic' })

    expect(slugsOf(answer)).toEqual(['notes'])
    expect(answer.results[0]?.snippet).toBe('Jazz Jazz quizzes, a jazzy prize.')
  })

  it('leaves out an entry unpublished since its vectors were made, and keeps to the locale', async () => {
    const { world, ids, reader, semantic } = await indexed('semantic-unpublished', ['moon', 'jazz'])
    await world.agent.unpublish({ id: ids['jazz'] ?? '' })
    const site = reader(semantic)

    const answer = await site.search({ query: 'fizz buzz jazz', mode: 'semantic' })
    const spanish = await site.search({ query: 'jazz', mode: 'semantic', locale: 'es' })

    expect(slugsOf(answer)).toEqual(['moon'])
    expect(slugsOf(spanish)).toEqual([])
  })

  it('merges both in hybrid: the words found keep their snippet, and meaning adds the rest', async () => {
    const { reader, semantic } = await indexed('semantic-hybrid', ['jazz', 'moon'])

    const answer = await reader(semantic).search({ query: 'moon' })

    expect(answer.mode).toBe('hybrid')
    expect(slugsOf(answer)).toEqual(['moon', 'jazz'])
    expect(answer.results[0]?.snippet).toBe('[Moon] on the moor, a moody noon.')
    expect(answer.results[1]?.snippet).toBe('Jazz Jazz Jazz quizzes, a jazzy prize.')
  })

  it('is full text, and says so, when the deployment has no semantic search', async () => {
    const { reader } = await indexed('semantic-absent', ['jazz', 'moon'])

    const answer = await reader(null).search({ query: 'fizz buzz jazz', mode: 'semantic' })

    expect([answer.mode, slugsOf(answer)]).toEqual(['fulltext', []])
  })
})

describe('related entries', () => {
  it('are the published entries closest to one, closest first, only when asked', async () => {
    const { world, ids, reader, semantic } = await indexed('related', ['moon', 'buzz', 'jazz'])
    const site = reader(semantic)
    const ref = { collection: 'blog', locale: 'en', slug: 'jazz' } as const

    const asked = await site.getEntry({ ...ref, related: true })
    const plain = await site.getEntry(ref)
    await world.agent.unpublish({ id: ids['buzz'] ?? '' })
    const after = await site.getEntry({ ...ref, related: true })
    const without = await reader(null).getEntry({ ...ref, related: true })

    expect(asked.related?.map((entry) => entry.slug)).toEqual(['buzz', 'moon'])
    expect(plain).not.toHaveProperty('related')
    expect(after.related?.map((entry) => entry.slug)).toEqual(['moon'])
    expect(without.related).toEqual([])
  })
})
