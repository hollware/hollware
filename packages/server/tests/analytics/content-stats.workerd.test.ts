import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AnalyticsSources, PageCount } from '../../src/ports.ts'
import { agent, blogPost, warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, publishPost, type World } from '../ops/world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

function sources(answer: Awaited<ReturnType<AnalyticsSources['topPages']>>) {
  const asked: unknown[] = []
  const analytics: AnalyticsSources = {
    connection: async () => null,
    async topPages(site, query) {
      asked.push({ site: site.key, ...query })
      return answer
    },
    connect: async () => ({ outcome: 'unavailable' }),
    disconnect: async () => false,
  }
  return { analytics, asked }
}

const read = (pages: readonly PageCount[]) => sources({ outcome: 'ok', provider: 'posthog', pages })

async function publishedPair(world: World) {
  const en = await createPost(world, { slug: 'read-a-lot', group: 'read-a-lot' })
  await createPost(world, { slug: 'se-lee-mucho', locale: 'es', group: 'read-a-lot' })
  await publishPost(world, en)
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug: 'only-a-draft',
    markdown: blogPost({ translationGroup: 'only-a-draft' }),
  })
}

describe('content_stats', () => {
  it('answers the most read pages, each with the published entry at its path', async () => {
    const world = await newWorld(env.DB, 'stats')
    await publishedPair(world)
    const { analytics, asked } = read([
      { path: '/en/blog/read-a-lot/', views: 40 },
      { path: '/en/blog/read-a-lot', views: 2 },
      { path: '/', views: 30 },
      { path: '/en/blog/only-a-draft/', views: 5 },
      { path: '/en/blog/read-a-lot/comments/', views: 1 },
    ])

    const answer = await agent({ ...world.context(), analytics }).contentStats({
      days: 7,
      limit: 5,
    })

    expect(asked).toEqual([{ site: world.tenant.key, days: 7, limit: 5 }])
    expect(answer.outcome).toBe('ok')
    expect(answer.since).toBe('2026-10-06T10:00:00.000Z')
    expect(answer.source).toBe('posthog')
    expect(answer.pages?.map((page) => [page.path, page.views, page.entry?.slug ?? null])).toEqual([
      ['/en/blog/read-a-lot/', 40, 'read-a-lot'],
      ['/en/blog/read-a-lot', 2, 'read-a-lot'],
      ['/', 30, null],
      ['/en/blog/only-a-draft/', 5, null],
      ['/en/blog/read-a-lot/comments/', 1, null],
    ])
  })

  it('is unavailable with the fix of the source when the site has connected none', async () => {
    const world = await newWorld(env.DB, 'stats-none')
    const { analytics } = sources({ outcome: 'unavailable', fix: 'Connect the analytics.' })

    expect(await agent({ ...world.context(), analytics }).contentStats({})).toEqual({
      outcome: 'unavailable',
      fix: 'Connect the analytics.',
    })
  })

  it('is unavailable where there are no sources at all, as over RPC', async () => {
    const world = await newWorld(env.DB, 'stats-rpc')

    expect(await world.agent.contentStats({})).toEqual({
      outcome: 'unavailable',
      fix: 'Ask over MCP: the analytics of a site are read there, not over RPC.',
    })
  })
})
