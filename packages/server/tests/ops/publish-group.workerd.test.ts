import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogFrontmatter, warmUpComark } from './support.ts'
import { entryColumns, newWorld, type World } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

async function linked(world: World, slug: string, linksTo: string, description = 'A post.') {
  const frontmatter = blogFrontmatter({ translationGroup: slug, description })
  const en = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: `${frontmatter}\nRead [the other post](/en/blog/${linksTo}/).\n`,
  })
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'es',
    slug: `${slug}-es`,
    markdown: `${frontmatter}\nTexto.\n`,
  })
  const entry = en.entry
  if (entry === undefined) throw new Error(`${slug} was not saved: ${JSON.stringify(en)}`)
  return { id: entry.id, version: entry.version }
}

async function statuses(world: World, ids: readonly string[]) {
  return Promise.all(ids.map(async (id) => (await entryColumns(world.db, id))?.status))
}

describe('publish with a group', () => {
  it('publishes two drafts that link to each other together, which neither can alone', async () => {
    const world = await newWorld(env.DB, 'group-cycle')
    const a = await linked(world, 'post-a', 'post-b')
    const b = await linked(world, 'post-b', 'post-a')

    const alone = await world.agent.publish(a)
    const together = await world.agent.publish({ ...a, group: [b] })

    expect(alone.outcome).toBe('blocked')
    expect(alone.verdict?.errors.map((error) => error.contract)).toEqual(['internal-links-resolve'])
    expect(together.outcome).toBe('published')
    expect(await statuses(world, [a.id, b.id])).toEqual(['published', 'published'])
  })

  it('publishes none, and names the member, when one of them is blocked', async () => {
    const world = await newWorld(env.DB, 'group-blocked')
    const a = await linked(world, 'post-a', 'post-b')
    const b = await linked(world, 'post-b', 'post-a', 'x'.repeat(161))

    const answer = await world.agent.publish({ ...a, group: [b] })

    expect([answer.outcome, answer.failedEntry, answer.entry?.id]).toEqual(['blocked', b.id, b.id])
    expect(await statuses(world, [a.id, b.id])).toEqual(['draft', 'draft'])
  })

  it('names the member with a warning nobody acknowledged, and publishes once it is', async () => {
    const world = await newWorld(env.DB, 'group-warning')
    const a = await linked(world, 'post-a', 'post-b')
    const b = await linked(world, 'post-b', 'post-a')
    await world.agent.updateDraft({
      id: b.id,
      version: 1,
      markdown: `${blogFrontmatter({ translationGroup: 'post-b', title: JSON.stringify('A title that runs well past the sixty characters that search engines show') })}\nRead [the other post](/en/blog/post-a/).\n`,
    })
    const ack = { contract: 'seo-title-length', path: '/frontmatter/title' }

    const asked = await world.agent.publish({ ...a, group: [{ id: b.id, version: 2 }] })
    const published = await world.agent.publish({
      ...a,
      group: [{ id: b.id, version: 2 }],
      acknowledgeWarnings: [ack],
    })

    expect([
      asked.outcome,
      asked.failedEntry,
      asked.verdict?.warnings.map((w) => w.contract),
    ]).toEqual(['needs_acknowledgement', b.id, ['seo-title-length']])
    expect(published.outcome).toBe('published')
  })

  it('publishes none, and names the member, when one of them is stale', async () => {
    const world = await newWorld(env.DB, 'group-stale')
    const a = await linked(world, 'post-a', 'post-b')
    const b = await linked(world, 'post-b', 'post-a')

    const answer = await world.agent.publish({ ...a, group: [{ id: b.id, version: 2 }] })

    expect([answer.outcome, answer.failedEntry, answer.conflict?.currentVersion]).toEqual([
      'conflict',
      b.id,
      1,
    ])
    expect(await statuses(world, [a.id, b.id])).toEqual(['draft', 'draft'])
  })
})
