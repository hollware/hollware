import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { entryColumns, newWorld, revisionsOf } from './world.ts'

// Fails when: the handlers stop walking an agent through AC-0.1-3 at the handler level. A draft
// whose contracts fail is no longer saved at version 1 with a verdict whose errors carry a fix
// (create-draft.ts, draft.ts, answers.ts); publish stops being blocked by those errors or by the
// rules that look at other entries (publish.ts); a write against a version the entry has left no
// longer answers conflict with the current version and head, or moves the head (update-draft.ts);
// validate moves the version (validate.ts); a publish with a warning no longer asks for its
// acknowledgement, or publishes without the acknowledgement being recorded, or get_entry no longer
// shows it in lastPublication (publish.ts, get-entry.ts, answers.ts).

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

/** The first draft of the agent: no description, an image without alt text, and a long title. */
const FIRST_DRAFT = blogPost(
  { title: TITLE, description: null },
  '\n# Edge caching guide\n\n![](/images/edge.png)\n',
)
/** The fix: a description and alt text. The long title stays, and is a warning. */
const FIXED_DRAFT = blogPost(
  { title: TITLE },
  '\n# Edge caching guide\n\n![A diagram](/images/edge.png)\n',
)
/** The Spanish translation, which the English entry needs before it can be published. */
const SPANISH_DRAFT = blogPost({ title: 'Guia de cache en el borde' }, '\n# Guia de cache\n')

describe('an agent writes and publishes a post, from an invalid draft to a published entry', () => {
  it('walks the flow of AC-0.1-3 over the handlers', async () => {
    const { agent, db } = await newWorld(env.DB, 'flow')
    const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }

    // 1. The agent reads what the site wants before it writes.
    const described = await agent.describeSite()
    expect(described.site.collections.map((collection) => collection.name)).toEqual([
      'blog',
      'notes',
    ])
    expect(described.site.collections[0]?.translationGroupField).toBe('translationGroup')

    // 2. An invalid draft is saved at version 1, and the verdict says what to fix.
    const created = await agent.createDraft({ ...english, markdown: FIRST_DRAFT })
    expect(created).toEqual({
      outcome: 'saved',
      entry: expect.objectContaining({ id: ENTRY_ID, version: 1, status: 'draft' }),
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
          },
          {
            contract: 'images-have-alt',
            severity: 'error',
            path: '/body',
            message: 'The image "/images/edge.png" has no alt text.',
            fix: 'Add alt text that describes the image, as in ![a short description](/images/edge.png).',
            line: 10,
          },
        ],
        warnings: [],
        contractsHash: HASH,
      },
    })
    const id = created.entry?.id ?? ''

    // 3. Publishing it is blocked by the same errors, in the publish phase.
    const blocked = await agent.publish({ id, version: 1 })
    expect(blocked.outcome).toBe('blocked')
    expect(blocked.verdict?.phase).toBe('publish')
    expect(blocked.verdict?.errors.map((error) => [error.contract, error.path])).toEqual([
      ['schema', '/frontmatter/description'],
      ['images-have-alt', '/body'],
    ])
    expect((await entryColumns(db, id))?.status).toBe('draft')

    // 4. The agent writes the Spanish version, which the English one needs to be published.
    const spanish = await agent.createDraft({
      collection: 'blog',
      locale: 'es',
      slug: 'guia-de-cache',
      markdown: SPANISH_DRAFT,
    })
    expect(spanish.outcome).toBe('saved')
    expect(spanish.verdict?.ok).toBe(true)

    // 5. The fixed draft is saved at version 2: no errors, and a warning about the long title.
    const fixed = await agent.updateDraft({ id, version: 1, markdown: FIXED_DRAFT })
    expect(fixed).toEqual({
      outcome: 'saved',
      entry: expect.objectContaining({ id, version: 2, status: 'draft' }),
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

    // 6. Writing against version 1 again is a conflict that names version 2 and the head, and
    // the head stays where it was.
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

    // 7. Validating writes nothing: the version is still 2.
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

    // 8. Publishing with a warning asks for it to be acknowledged.
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

    // 9. Acknowledging the warning publishes.
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

    // 10. The entry shows the warning that was acknowledged.
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
