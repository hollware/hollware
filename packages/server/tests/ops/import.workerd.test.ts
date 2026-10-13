import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { BLOG_CORPUS } from '../../../../tests/fixtures/content.ts'
import { countRows } from '../db/support.ts'
import { warmUpComark } from './support.ts'
import { newWorld, snapshotOf, type World } from './world.ts'

// Fails when: importing the same files twice stops being a no-op (AC-0.1-9, which is what makes
// the import of the CLI idempotent): update-draft.ts stops answering `unchanged` for the file
// that the head already holds, and writes a revision or moves the version instead; or
// create-draft.ts stops saving a whole corpus of translations and tags the first time.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

/**
 * What the import of the CLI does for each file: read the entry by its key, create it when there
 * is none, and otherwise write the file against the version that was read.
 */
async function importCorpus(agent: World['agent'], corpus = BLOG_CORPUS) {
  const outcomes: string[] = []
  for (const file of corpus) {
    const key = { collection: file.collection, locale: file.locale, slug: file.slug }
    const existing = await agent.getEntry(key)
    const answer =
      existing.entry === undefined
        ? await agent.createDraft({ ...key, markdown: file.markdown })
        : await agent.updateDraft({
            id: existing.entry.id,
            version: existing.entry.version,
            markdown: file.markdown,
          })
    outcomes.push(answer.outcome)
  }
  return outcomes
}

describe('importing the files of a site', () => {
  it('creates every entry of the corpus the first time: ten entries in five translation groups', async () => {
    const world = await newWorld(env.DB, 'import')

    const outcomes = await importCorpus(world.agent)

    expect(outcomes).toEqual(Array.from({ length: 10 }, () => 'saved'))
    const list = await world.agent.listEntries({ collection: 'blog', limit: 100 })
    expect(list.entries).toHaveLength(10)
    expect(list.entries.every((entry) => entry.version === 1)).toBe(true)
    for (const group of [
      'agents-and-contracts',
      'edge-caching',
      'markdown-source',
      'publishing-flow',
      'site-isolation',
    ]) {
      const translations = await world.agent.getTranslations({
        collection: 'blog',
        translationGroup: group,
      })
      expect(translations.entries?.map((entry) => entry.locale)).toEqual(['en', 'es'])
    }
    // Two tags for each entry but the two about Markdown as the source of truth, which have one.
    expect(await countRows(env.DB, 'revision_tags', world.tenant.key)).toBe(18)
  })

  it('answers unchanged to every file the second time, and no version moves', async () => {
    const world = await newWorld(env.DB, 'import')
    await importCorpus(world.agent)
    const before = await snapshotOf(env.DB, world.tenant.key)
    world.time.set('2026-10-14T10:00:00.000Z')

    const outcomes = await importCorpus(world.agent)

    expect(outcomes).toEqual(Array.from({ length: 10 }, () => 'unchanged'))
    // Not a revision, not a tag, not a version, not even the time of the last change.
    expect(await snapshotOf(env.DB, world.tenant.key)).toEqual(before)
    expect(before.counts).toEqual({ revisions: 10, revision_tags: 18, publications: 0 })
  })

  it('writes only the file that changed when the corpus changes', async () => {
    const world = await newWorld(env.DB, 'import')
    await importCorpus(world.agent)
    const changed = BLOG_CORPUS.map((file) =>
      file.slug === 'edge-caching-basics'
        ? { ...file, markdown: `${file.markdown}\nOne more line.\n` }
        : file,
    )

    const outcomes = await importCorpus(world.agent, changed)

    expect(outcomes).toEqual(
      BLOG_CORPUS.map((file) => (file.slug === 'edge-caching-basics' ? 'saved' : 'unchanged')),
    )
    const edited = await world.agent.getEntry({
      collection: 'blog',
      locale: 'en',
      slug: 'edge-caching-basics',
    })
    expect(edited.entry?.version).toBe(2)
    expect(await countRows(env.DB, 'revisions', world.tenant.key)).toBe(11)
  })
})
