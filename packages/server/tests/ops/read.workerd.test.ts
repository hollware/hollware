import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, publicationsOf, publishPost } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const listed = <T extends { locale: string; translationGroup: string | null }>(summary: T) =>
  summary.locale === 'es' || summary.translationGroup === null
    ? summary
    : { ...summary, translationOutdated: false }

describe('describe_site', () => {
  it('describes the site, its collections and the contracts that every collection is checked against', async () => {
    const { agent, tenant } = await newWorld(env.DB, 'describe')

    const { site } = await agent.describeSite()

    expect({
      key: site.key,
      locales: site.locales,
      defaultLocale: site.defaultLocale,
      styleGuide: site.styleGuide,
    }).toEqual({ key: tenant.key, locales: ['es', 'en'], defaultLocale: 'es', styleGuide: null })
    const [blog, notes] = site.collections
    expect(blog).toMatchObject({
      name: 'blog',
      routes: { es: '/blog/:slug/', en: '/en/blog/:slug/' },
      translationGroupField: 'translationGroup',
      tagsField: 'tags',
      sortByField: 'date',
      maxMarkdownBytes: 524_288,
      styleGuide: 'Short paragraphs, one idea per section, and an example for every claim.',
    })
    expect(blog?.components.map((component) => component.name)).toEqual(['callout', 'youtube'])
    expect(blog?.contracts.map((contract) => contract.id)).toEqual([
      'schema',
      'components',
      'raw-html',
      'unknown-component',
      'disallowed-attribute',
      'unsafe-url',
      'size-limit',
      'frontmatter-syntax',
      'comark-parse',
      'unique-slug',
      'unique-translation',
      'translation-pair',
      'internal-links-resolve',
      'images-have-alt',
      'seo-title-length',
    ])
    expect(blog?.contracts.at(-1)).toEqual({
      id: 'seo-title-length',
      severity: 'warning',
      phases: ['write', 'publish'],
      description: 'A title of at most 60 characters, or a seoTitle, which search engines show.',
    })
    expect(blog?.contracts.at(-4)).toEqual({
      id: 'translation-pair',
      severity: 'error',
      phases: ['publish'],
      description:
        'Every locale of the site has an entry in the translation group of this entry. Checked when publishing.',
    })
    expect(notes).toMatchObject({
      name: 'notes',
      translationGroupField: null,
      tagsField: null,
      sortByField: null,
      maxMarkdownBytes: 786_432,
    })
  })

  it('answers with the same description every time, which is frozen because every call shares it', async () => {
    const { agent } = await newWorld(env.DB, 'describe')

    const first = await agent.describeSite()
    const second = await agent.describeSite()

    expect(second.site).toBe(first.site)
    expect(Object.isFrozen(first.site)).toBe(true)
  })
})

describe('list_entries', () => {
  async function threeDrafts(label: string) {
    const world = await newWorld(env.DB, label)
    const edge = await createPost(world, {
      slug: 'edge-caching',
      group: 'edge-caching',
      tags: '[cloudflare, cms]',
      at: '2026-10-13T10:00:00.000Z',
    })
    const borde = await createPost(world, {
      slug: 'cache-en-el-borde',
      locale: 'es',
      group: 'edge-caching',
      tags: '[cloudflare, cms]',
      at: '2026-10-13T10:10:00.000Z',
    })
    const agents = await createPost(world, {
      slug: 'agents-write',
      group: 'agents',
      tags: '[agents]',
      at: '2026-10-13T10:20:00.000Z',
    })
    return { world, edge, borde, agents }
  }

  it('lists the entries of a collection as summaries, the latest change first', async () => {
    const { world, edge, borde, agents } = await threeDrafts('list')

    const page = await world.agent.listEntries({ collection: 'blog' })

    expect(page).toEqual({
      outcome: 'ok',
      entries: [agents, borde, edge].map(listed),
      nextCursor: null,
    })
    expect(page.entries[0]).toEqual({
      id: agents.id,
      collection: 'blog',
      locale: 'en',
      slug: 'agents-write',
      translationGroup: 'agents',
      status: 'draft',
      version: 1,
      frontmatter: {
        title: 'Post agents-write',
        description: 'How to cache at the edge.',
        date: '2026-10-01',
        tags: ['agents'],
        translationGroup: 'agents',
      },
      tags: ['agents'],
      hasUnpublishedChanges: true,
      publishedAt: null,
      scheduledAt: null,
      deletedAt: null,
      updatedAt: '2026-10-13T10:20:00.000Z',
      translationOutdated: false,
    })
  })

  it('gives a page of the size asked for, and a cursor to the next one', async () => {
    const { world, edge, borde, agents } = await threeDrafts('list')

    const first = await world.agent.listEntries({ collection: 'blog', limit: 2 })
    const second = await world.agent.listEntries({
      collection: 'blog',
      limit: 2,
      cursor: first.nextCursor ?? '',
    })

    expect(first.entries).toEqual([agents, borde].map(listed))
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second).toEqual({ outcome: 'ok', entries: [edge].map(listed), nextCursor: null })
  })

  it('filters by locale, by tag and by status', async () => {
    const { world, edge, borde, agents } = await threeDrafts('list')
    await publishPost(world, edge, '2026-10-13T10:30:00.000Z')
    await publishPost(world, borde, '2026-10-13T10:40:00.000Z')

    const spanish = await world.agent.listEntries({ collection: 'blog', locale: 'es' })
    const cms = await world.agent.listEntries({ collection: 'blog', tag: 'cms' })
    const drafts = await world.agent.listEntries({ collection: 'blog', status: 'draft' })
    const published = await world.agent.listEntries({ collection: 'blog', status: 'published' })

    expect(spanish.entries.map((entry) => entry.slug)).toEqual(['cache-en-el-borde'])
    expect(cms.entries.map((entry) => entry.slug)).toEqual(['cache-en-el-borde', 'edge-caching'])
    expect(drafts.entries.map((entry) => entry.id)).toEqual([agents.id])
    expect(published.entries.map((entry) => entry.slug)).toEqual([
      'cache-en-el-borde',
      'edge-caching',
    ])
  })

  it('lists with changedSince only the entries changed at or after that time, in both views, a time with an offset read as the same instant', async () => {
    const { world, edge, borde } = await threeDrafts('list')
    await publishPost(world, edge, '2026-10-13T10:30:00.000Z')
    await publishPost(world, borde, '2026-10-13T10:40:00.000Z')

    const head = await world.agent.listEntries({
      collection: 'blog',
      changedSince: '2026-10-13T10:20:00.000Z',
    })
    const offset = await world.agent.listEntries({
      collection: 'blog',
      changedSince: '2026-10-13T12:30:00.000+02:00',
    })
    const published = await world.reader.listEntries({
      collection: 'blog',
      changedSince: '2026-10-13T10:40:00.000Z',
    })

    expect(head.entries.map((entry) => entry.slug)).toEqual([
      'cache-en-el-borde',
      'edge-caching',
      'agents-write',
    ])
    expect(offset.entries.map((entry) => entry.slug)).toEqual(['cache-en-el-borde', 'edge-caching'])
    expect(published.entries.map((entry) => entry.slug)).toEqual(['cache-en-el-borde'])
  })

  it('lists nothing for a collection that has no entries', async () => {
    const { agent } = await newWorld(env.DB, 'list')

    expect(await agent.listEntries({ collection: 'notes' })).toEqual({
      outcome: 'ok',
      entries: [],
      nextCursor: null,
    })
  })

  it('lets the invalid_input of the store through when the cursor is not one it gave', async () => {
    const { agent } = await newWorld(env.DB, 'list')

    await expect(
      agent.listEntries({ collection: 'blog', cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({
      name: 'HollwareError',
      code: 'invalid_input',
      message: 'The cursor is not valid for this listing.',
    })
  })
})

describe('get_entry', () => {
  const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }

  it('answers not_found for an entry that does not exist', async () => {
    const { agent } = await newWorld(env.DB, 'get')

    expect(await agent.getEntry(english)).toEqual({ outcome: 'not_found' })
  })

  it('gives the summary and the latest revision with its Markdown, when nothing else is asked for', async () => {
    const { agent } = await newWorld(env.DB, 'get')
    const markdown = blogPost()
    const created = await agent.createDraft({ ...english, markdown })

    const read = await agent.getEntry(english)

    expect(read.outcome).toBe('ok')
    expect(read.entry).toEqual({
      ...created.entry,
      translationOutdated: false,
      revision: expect.stringMatching(/^rev_[0-9A-HJKMNP-TV-Z]{26}$/),
      unpublishAt: null,
      verdict: created.verdict,
      lastPublication: null,
      markdown,
    })
  })

  it('reads the revision that is live when asked for published, and not_found before it is', async () => {
    const world = await newWorld(env.DB, 'get-published')
    const en = await createPost(world, { slug: 'edge-caching-guide', group: 'edge-caching-guide' })
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
    const ref = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }
    const before = await world.agent.getEntry({ ...ref, published: true })
    const live = (await world.agent.getEntry(ref)).entry?.markdown
    const published = await publishPost(world, en)
    await world.agent.updateDraft({
      id: en.id,
      version: published.version,
      markdown: blogPost({ title: 'Edge caching, again', translationGroup: 'edge-caching-guide' }),
    })

    const after = await world.agent.getEntry({ ...ref, published: true })
    const head = await world.agent.getEntry(ref)

    expect(before).toEqual({ outcome: 'not_found' })
    expect(after.entry?.markdown).toBe(live)
    expect(head.entry?.markdown).not.toBe(live)
  })

  it('gives only the formats that are asked for', async () => {
    const { agent } = await newWorld(env.DB, 'get')
    await agent.createDraft({ ...english, markdown: blogPost() })
    const keys = async (formats: ('markdown' | 'document' | 'html')[]) =>
      Object.keys((await agent.getEntry({ ...english, formats })).entry ?? {})
        .filter((key) => ['markdown', 'document', 'html'].includes(key))
        .toSorted()

    expect(await keys(['markdown'])).toEqual(['markdown'])
    expect(await keys(['document'])).toEqual(['document'])
    expect(await keys(['html'])).toEqual(['html'])
    expect(await keys(['html', 'markdown', 'document'])).toEqual(['document', 'html', 'markdown'])
  })

  it('gives the Comark document and its HTML', async () => {
    const { agent } = await newWorld(env.DB, 'get')
    await agent.createDraft({ ...english, markdown: blogPost() })

    const { entry } = await agent.getEntry({ ...english, formats: ['document', 'html'] })

    expect(entry?.document).toEqual({
      frontmatter: {
        title: 'Edge caching guide',
        description: 'How to cache at the edge.',
        date: '2026-10-01',
        tags: ['cloudflare', 'cms'],
        translationGroup: 'edge-caching-guide',
      },
      meta: {},
      nodes: [
        ['h1', { id: 'edge-caching-guide' }, 'Edge caching guide'],
        ['p', {}, 'What an edge cache keeps.'],
      ],
    })
    expect(entry?.html).toBe(
      '<h1 id="edge-caching-guide">Edge caching guide</h1>\n<p>What an edge cache keeps.</p>',
    )
  })

  it('shows the latest revision, which differs from the live one once the entry is edited', async () => {
    const world = await newWorld(env.DB, 'get')
    const draft = await createPost(world, { slug: 'edge-caching-guide', group: 'guide' })
    await createPost(world, { slug: 'guia', locale: 'es', group: 'guide' })
    const published = await publishPost(world, draft)
    const live = (await world.agent.getEntry(english)).entry

    const edited = await world.agent.updateDraft({
      id: draft.id,
      version: published.version,
      markdown: blogPost({ title: 'A newer title', translationGroup: 'guide' }),
    })
    const head = (await world.agent.getEntry(english)).entry

    expect(live?.hasUnpublishedChanges).toBe(false)
    expect(edited.entry?.status).toBe('published')
    expect(edited.entry?.hasUnpublishedChanges).toBe(true)
    expect(head?.hasUnpublishedChanges).toBe(true)
    expect(head?.frontmatter['title']).toBe('A newer title')
    expect(head?.revision).not.toBe(live?.revision)
    expect(head?.lastPublication?.revision).toBe(live?.revision)
  })

  it('shows the verdict that the revision was written with, even when it holds errors', async () => {
    const { agent } = await newWorld(env.DB, 'get')
    const created = await agent.createDraft({
      ...english,
      markdown: blogPost({ description: null }),
    })

    const { entry } = await agent.getEntry(english)

    expect(created.verdict?.ok).toBe(false)
    expect(entry?.verdict).toEqual(created.verdict)
    expect(entry?.verdict.errors.map((error) => [error.contract, error.path])).toEqual([
      ['schema', '/frontmatter/description'],
    ])
  })

  it('shows the last publication, nothing before the first publish and nothing after an unpublish', async () => {
    const world = await newWorld(env.DB, 'get')
    const draft = await createPost(world, { slug: 'edge-caching-guide', group: 'guide' })
    await createPost(world, { slug: 'guia', locale: 'es', group: 'guide' })
    const lastPublication = async () => (await world.agent.getEntry(english)).entry?.lastPublication

    expect(await lastPublication()).toBeNull()

    const published = await publishPost(world, draft, '2026-10-13T11:00:00.000Z')
    expect(await lastPublication()).toMatchObject({
      acknowledged: [],
      at: '2026-10-13T11:00:00.000Z',
      verdict: { ok: true, phase: 'publish' },
    })

    world.time.set('2026-10-13T12:00:00.000Z')
    await world.agent.unpublish({ id: draft.id })
    expect(await lastPublication()).toBeNull()
    expect((await publicationsOf(world.db, draft.id)).map((row) => row.action)).toEqual([
      'publish',
      'unpublish',
    ])

    const again = await world.agent.publish({ id: draft.id, version: published.version + 1 })
    expect(again.outcome).toBe('published')
    expect(await lastPublication()).toMatchObject({ at: '2026-10-13T12:00:00.000Z' })
  })
})

describe('get_translations', () => {
  it('gives the entries of a translation group, one per locale', async () => {
    const world = await newWorld(env.DB, 'translations')
    const english = await createPost(world, { slug: 'edge-caching', group: 'edge-caching' })
    const spanish = await createPost(world, {
      slug: 'cache-en-el-borde',
      locale: 'es',
      group: 'edge-caching',
    })
    await createPost(world, { slug: 'agents-write', group: 'agents' })

    const group = await world.agent.getTranslations({
      collection: 'blog',
      translationGroup: 'edge-caching',
    })

    expect(group).toEqual({ outcome: 'ok', entries: [english, spanish].map(listed) })
  })

  it('answers not_found for a group that has no entries', async () => {
    const world = await newWorld(env.DB, 'translations')
    await createPost(world, { slug: 'edge-caching', group: 'edge-caching' })

    expect(
      await world.agent.getTranslations({ collection: 'blog', translationGroup: 'agents' }),
    ).toEqual({ outcome: 'not_found' })
  })
})
