import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import { blogPost, warmUpComark } from './support.ts'
import { createPost, entryColumns, newWorld, revisionsOf } from './world.ts'

// Fails when: a draft that content safety stops (ADR-020, AC-0.1-14) stops being saved with one
// error for each thing, every one with a fix (create-draft.ts, draft.ts), stops being blocked from
// publishing (publish.ts), or is stored as something else than the bytes that came in
// (draft.ts revisionOf, which stores the file as given, not what the pipeline made of it); or
// get_entry hands out the HTML of such a draft with what the pipeline kept out of it.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const english = { collection: 'blog', locale: 'en', slug: 'a-hostile-post' }

/** Each hostile post of the fixtures that has markers, and the contract and line of each one. */
const WITH_MARKERS: readonly (readonly [string, readonly (readonly [string, number])[]])[] = [
  [
    'raw-html',
    [
      ['raw-html', 10],
      ['raw-html', 10],
    ],
  ],
  [
    'block-html',
    [
      ['raw-html', 10],
      ['raw-html', 12],
      ['raw-html', 12],
    ],
  ],
  ['unknown-component', [['unknown-component', 12]]],
  [
    'disallowed-attribute',
    [
      ['disallowed-attribute', 10],
      ['disallowed-attribute', 10],
    ],
  ],
  [
    'unsafe-url',
    [
      ['unsafe-url', 10],
      ['unsafe-url', 10],
      ['unsafe-url', 10],
    ],
  ],
]

/** What the HTML of an entry must never hold, whatever the tag or the attribute. */
const ACTIVE_CONTENT =
  /<script|<iframe|<svg|<img[^>]*onerror|\sonclick|\sstyle=|javascript:|vbscript:|data:/i

describe('a draft that holds what content safety stops', () => {
  it.each(WITH_MARKERS)(
    'is saved with one error for each marker of %s, every one with a fix, and publishing it is blocked',
    async (name, markers) => {
      const world = await newWorld(env.DB, 'safety')
      const markdown = contentFixture(`hostile/${name}.md`)

      const created = await world.agent.createDraft({ ...english, markdown })
      const blocked = await world.agent.publish({ id: created.entry?.id ?? '', version: 1 })

      expect(created.outcome).toBe('saved')
      expect(created.verdict?.ok).toBe(false)
      expect(created.verdict?.errors.map((error) => [error.contract, error.line])).toEqual(markers)
      for (const error of created.verdict?.errors ?? []) {
        expect(error).toMatchObject({ severity: 'error', path: '/body' })
        expect(error.message).toMatch(/\S/)
        expect(error.fix).toMatch(/\S/)
      }
      expect(blocked.outcome).toBe('blocked')
      expect(blocked.verdict?.phase).toBe('publish')
      // The same markers, and what publishing also asks (a translation, the links of the file).
      expect(
        blocked.verdict?.errors
          .filter((error) => markers.some(([contract]) => contract === error.contract))
          .map((error) => [error.contract, error.line]),
      ).toEqual(markers)
      expect(await entryColumns(world.db, created.entry?.id ?? '')).toMatchObject({
        status: 'draft',
        version: 1,
      })
    },
  )

  it.each(WITH_MARKERS)(
    'is stored as the bytes that came in, and %s is never rewritten to make it safe',
    async (name) => {
      const world = await newWorld(env.DB, 'safety')
      const markdown = contentFixture(`hostile/${name}.md`)
      const created = await world.agent.createDraft({ ...english, markdown })
      const id = created.entry?.id ?? ''

      const [revision] = await revisionsOf(world.db, id)
      const read = await world.agent.getEntry({ ...english, formats: ['markdown', 'html'] })
      const bytes = await world.db
        .prepare('SELECT length(CAST(markdown AS BLOB)) AS bytes FROM revisions WHERE entry_id = ?')
        .bind(id)
        .first<number>('bytes')

      expect(revision?.markdown).toBe(markdown)
      expect(read.entry?.markdown).toBe(markdown)
      expect(bytes).toBe(new TextEncoder().encode(markdown).length)
      // What is rendered holds none of it.
      expect(read.entry?.html).not.toMatch(ACTIVE_CONTENT)
    },
  )

  it('is refused when its frontmatter does not parse, and nothing is stored', async () => {
    const world = await newWorld(env.DB, 'safety')

    const created = await world.agent.createDraft({
      ...english,
      markdown: contentFixture('hostile/broken-frontmatter.md'),
    })

    expect(created.outcome).toBe('refused')
    expect(created.verdict?.errors.map((error) => [error.contract, error.line])).toEqual([
      ['frontmatter-syntax', 3],
    ])
    expect((await world.agent.getEntry(english)).outcome).toBe('not_found')
  })

  it.each(['nested-emphasis', 'bom'])(
    'is saved with nothing to fix, byte for byte, when it is only strange: %s',
    async (name) => {
      const world = await newWorld(env.DB, 'safety')
      const markdown = contentFixture(`hostile/${name}.md`)

      const created = await world.agent.createDraft({ ...english, markdown })

      expect(created.outcome).toBe('saved')
      expect(created.verdict?.errors).toEqual([])
      const [revision] = await revisionsOf(world.db, created.entry?.id ?? '')
      expect(revision?.markdown).toBe(markdown)
    },
  )

  it('keeps the byte order mark of a file that has one', async () => {
    const world = await newWorld(env.DB, 'safety')
    const markdown = contentFixture('hostile/bom.md')
    expect(markdown.codePointAt(0)).toBe(0xfeff)

    const created = await world.agent.createDraft({ ...english, markdown })

    const [revision] = await revisionsOf(world.db, created.entry?.id ?? '')
    expect(revision?.markdown.codePointAt(0)).toBe(0xfeff)
    expect(revision?.markdown).toHaveLength(markdown.length)
  })

  it('can be published once what the errors name is fixed, and the page that readers get holds plain HTML', async () => {
    const world = await newWorld(env.DB, 'safety')
    await createPost(world, { slug: 'una-entrada', locale: 'es', group: 'hostile' })
    const created = await world.agent.createDraft({
      ...english,
      markdown: contentFixture('hostile/unsafe-url.md'),
    })
    expect(created.verdict?.errors).toHaveLength(3)

    const fixed = await world.agent.updateDraft({
      id: created.entry?.id ?? '',
      version: 1,
      markdown: blogPost(
        { translationGroup: 'hostile' },
        '\nA [good link](https://example.com/) and an image ![A cat](/images/cat.png).\n',
      ),
    })
    const published = await world.agent.publish({ id: created.entry?.id ?? '', version: 2 })
    const page = await world.reader.getEntry({ ...english, formats: ['html'] })

    expect(fixed.verdict?.errors).toEqual([])
    expect(published.outcome).toBe('published')
    expect(page.entry?.html).toBe(
      '<p>A <a href="https://example.com/">good link</a> and an image <img src="/images/cat.png" alt="A cat">.</p>',
    )
  })
})
