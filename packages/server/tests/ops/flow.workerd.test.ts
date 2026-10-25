import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { entryColumns, newWorld, revisionsOf } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const ENTRY_ID = expect.stringMatching(/^ent_[0-9A-HJKMNP-TV-Z]{26}$/)
const REVISION_ID = expect.stringMatching(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/)
const HASH = expect.stringMatching(/^[0-9a-f]{64}$/)

const TITLE = 'A guide to caching at the edge of the network with Workers and D1 tonight'
const TITLE_WARNING = {
  contract: 'seo-title-length',
  severity: 'warning',
  path: '/frontmatter/title',
  message: 'The title has 73 characters; search engines show about 60.',
  fix: 'Shorten the title to 60 characters or fewer, or add a seoTitle of at most 60.',
}

const FIRST_DRAFT = blogPost(
  { title: TITLE, description: null },
  '\n# Edge caching guide\n\n![](/images/edge.png)\n',
)
const FIXED_DRAFT = blogPost(
  { title: TITLE },
  '\n# Edge caching guide\n\n![A diagram](/images/edge.png)\n',
)
const SPANISH_DRAFT = blogPost({ title: 'Guia de cache en el borde' }, '\n# Guia de cache\n')

describe('an agent writes and publishes a post, from an invalid draft to a published entry', () => {
  it('walks the flow of AC-0.1-3 over the handlers', async () => {
    const { agent, db } = await newWorld(env.DB, 'flow')
    const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }

    const described = await agent.describeSite()
    expect(described.site.collections.map((collection) => collection.name)).toEqual([
      'blog',
      'notes',
    ])
    expect(described.site.collections[0]?.translationGroupField).toBe('translationGroup')

    const created = await agent.createDraft({ ...english, markdown: FIRST_DRAFT })
    expect(created).toEqual({
      outcome: 'saved',
      entry: expect.objectContaining({ id: ENTRY_ID, version: 1, status: 'draft' }),
      markdown: FIRST_DRAFT,
      verdict: {
        ok: false,
        phase: 'write',
        errors: [
          {
            contract: 'schema',
            severity: 'error',
            path: '/frontmatter/description',
            message: 'Invalid input: expected string, received undefined',
            fix: 'Set the field "description" to a string of 1 to 160 characters.',
            code: 'schema.missing',
            params: { expected: 'string', field: 'description' },
          },
          {
            contract: 'images-have-alt',
            severity: 'error',
            path: '/body',
            message: 'The image "/images/edge.png" has no alt text.',
            fix: 'Add alt text that describes the image, as in ![a short description](/images/edge.png).',
            params: { src: '/images/edge.png' },
            line: 12,
          },
        ],
        warnings: [],
        contractsHash: HASH,
      },
    })
    const id = created.entry?.id ?? ''

    const blocked = await agent.publish({ id, version: 1 })
    expect(blocked.outcome).toBe('blocked')
    expect(blocked.verdict?.phase).toBe('publish')
    expect(blocked.verdict?.errors.map((error) => [error.contract, error.path])).toEqual([
      ['schema', '/frontmatter/description'],
      ['images-have-alt', '/body'],
    ])
    expect((await entryColumns(db, id))?.status).toBe('draft')

    const spanish = await agent.createDraft({
      collection: 'blog',
      locale: 'es',
      slug: 'guia-de-cache',
      markdown: SPANISH_DRAFT,
    })
    expect(spanish.outcome).toBe('saved')
    expect(spanish.verdict?.ok).toBe(true)

    const fixed = await agent.updateDraft({ id, version: 1, markdown: FIXED_DRAFT })
    expect(fixed).toEqual({
      outcome: 'saved',
      entry: expect.objectContaining({ id, version: 2, status: 'draft' }),
      markdown: FIXED_DRAFT,
      verdict: {
        ok: true,
        phase: 'write',
        errors: [],
        warnings: [TITLE_WARNING],
        contractsHash: HASH,
      },
    })
    const head = (await agent.getEntry({ ...english })).entry?.revision
    expect(head).toEqual(REVISION_ID)

    const stale = await agent.updateDraft({
      id,
      version: 1,
      markdown: blogPost({ title: 'Another title' }),
    })
    expect(stale).toEqual({
      outcome: 'conflict',
      conflict: { currentVersion: 2, headRevision: head },
    })
    expect((await entryColumns(db, id))?.head_rev).toBe(head)
    expect(await revisionsOf(db, id)).toHaveLength(2)

    const validated = await agent.validate({ ...english, markdown: FIXED_DRAFT })
    expect(validated).toEqual({
      outcome: 'ok',
      verdict: {
        ok: true,
        phase: 'publish',
        errors: [],
        warnings: [TITLE_WARNING],
        contractsHash: HASH,
      },
    })
    expect((await entryColumns(db, id))?.version).toBe(2)

    const asked = await agent.publish({ id, version: 2 })
    expect(asked).toEqual({
      outcome: 'needs_acknowledgement',
      entry: expect.objectContaining({ id, version: 2, status: 'draft' }),
      verdict: {
        ok: true,
        phase: 'publish',
        errors: [],
        warnings: [TITLE_WARNING],
        contractsHash: HASH,
      },
    })
    expect((await entryColumns(db, id))?.status).toBe('draft')

    const published = await agent.publish({
      id,
      version: 2,
      acknowledgeWarnings: [{ contract: 'seo-title-length', path: '/frontmatter/title' }],
    })
    expect(published).toEqual({
      outcome: 'published',
      entry: expect.objectContaining({
        id,
        version: 3,
        status: 'published',
        hasUnpublishedChanges: false,
        publishedAt: '2026-10-13T10:00:00.000Z',
      }),
      verdict: {
        ok: true,
        phase: 'publish',
        errors: [],
        warnings: [TITLE_WARNING],
        contractsHash: HASH,
      },
    })

    const read = await agent.getEntry({ ...english })
    expect(read.entry?.lastPublication).toEqual({
      revision: head,
      verdict: {
        ok: true,
        phase: 'publish',
        errors: [],
        warnings: [TITLE_WARNING],
        contractsHash: HASH,
      },
      acknowledged: [{ contract: 'seo-title-length', path: '/frontmatter/title' }],
      at: '2026-10-13T10:00:00.000Z',
    })
  })
})
