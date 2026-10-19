import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ResolvedSite } from '@hollware/core'
import { agent, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost, type World } from './world.ts'

// Fails when the fields a collection says Hollware fills (src/ops/automatic.ts, core's
// automatic.ts) stop reaching a site filled, in get_entry (its frontmatter and its document),
// list_entries and get_translations; or reach an agent over MCP in the frontmatter, which reads
// what was written; or get_entry stops answering their values apart as `automatic`; or the date
// written in the Markdown stops winning for firstPublished, a change after the first publication
// stops showing as lastModified, or the reading time is not the words at 200 a minute.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const FIRST = '2026-10-13T10:00:00.000Z'
const LATER = '2026-10-20T09:30:00.000Z'

/** The tenant's site with blog's `date`, `modified` and `minutes` filled by Hollware. */
function withAutomatic(world: World): ResolvedSite {
  const site = world.tenant.site
  const blog = site.collections.get('blog')
  if (blog === undefined) throw new Error('no blog')
  const collections = new Map(site.collections)
  collections.set('blog', {
    ...blog,
    automaticFields: {
      date: { kind: 'firstPublished', format: 'date' },
      modified: { kind: 'lastModified', format: 'date-time' },
      minutes: { kind: 'readingTime', format: 'number' },
      words: { kind: 'wordCount', format: 'number' },
    },
  })
  return { ...site, collections }
}

describe('the fields Hollware fills', () => {
  it('reach a site filled, and an agent as written, with their values apart', async () => {
    const world = await newWorld(env.DB, 'automatic')
    const site = withAutomatic(world)
    const en = await createPost(world, { slug: 'filled', group: 'filled', date: '2020-01-01' })
    await createPost(world, { slug: 'lleno', locale: 'es', group: 'filled' })
    const live = await publishPost(world, en, FIRST)
    const reader = agent({ ...world.context({ view: 'published' }), site })
    const mcp = agent({ ...world.context(), site })
    const key = { collection: 'blog', locale: 'en', slug: 'filled' }

    const first = await reader.getEntry({ ...key, formats: ['document'] })
    world.time.set(LATER)
    const changed = await world.agent.updateDraft({
      id: en.id,
      version: live.version,
      markdown: `---\ntitle: Filled\ndescription: d\ndate: 2020-01-01\ntags: [cloudflare]\ntranslationGroup: filled\n---\n\n${'word '.repeat(450)}\n`,
    })
    await publishPost(world, changed.entry ?? en, LATER)
    const second = await reader.getEntry({ ...key, formats: ['document'] })
    const agentView = await mcp.getEntry({ ...key, published: true })
    const listed = await reader.listEntries({ collection: 'blog', locale: 'en' })
    const group = await reader.getTranslations({ collection: 'blog', translationGroup: 'filled' })

    // The date written wins; nothing changed after the first publication; eight words, a minute.
    expect(first.entry?.frontmatter).toMatchObject({ date: '2020-01-01', minutes: 1, words: 8 })
    expect(first.entry?.frontmatter).not.toHaveProperty('modified')
    // Changed after it went out: modified is when; 450 words are three minutes.
    expect(second.entry?.frontmatter).toMatchObject({
      date: '2020-01-01',
      modified: LATER,
      minutes: 3,
    })
    expect(second.entry?.document?.frontmatter).toMatchObject({ modified: LATER, minutes: 3 })
    expect(listed.entries?.[0]?.frontmatter).toMatchObject({ modified: LATER, minutes: 3 })
    expect(group.entries?.find((one) => one.locale === 'en')?.frontmatter).toMatchObject({
      modified: LATER,
    })
    // An agent reads what was written, and the values apart.
    expect(agentView.entry?.frontmatter).not.toHaveProperty('modified')
    expect(agentView.entry?.automatic).toEqual({
      date: '2020-01-01',
      modified: LATER,
      minutes: 3,
      words: 450,
    })
  })
})
