import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { AnalyticsReader, PageCount } from '../../src/ports.ts'
import { agent, blogPost, warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, publishPost, type World } from '../ops/world.ts'

// Fails when: content_stats (src/ops/content-stats.ts) stops asking the analytics for the days and
// the limit of its input, stops answering each page with its views and the published entry that
// the routes of the site put at its path (with or without its trailing slash), answers an entry
// that is not published or a path that no route has, stops saying since when it counts, or stops
// answering unavailable when the deployment cannot read its analytics.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

function reader(pages: readonly PageCount[]) {
  const asked: unknown[] = []
  const analytics: AnalyticsReader = {
    async topPages(site, query) {
      asked.push({ site, ...query })
      return pages
    },
  }
  return { analytics, asked }
}

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
    const { analytics, asked } = reader([
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
    expect(answer.pages?.map((page) => [page.path, page.views, page.entry?.slug ?? null])).toEqual([
      ['/en/blog/read-a-lot/', 40, 'read-a-lot'],
      ['/en/blog/read-a-lot', 2, 'read-a-lot'],
      ['/', 30, null],
      ['/en/blog/only-a-draft/', 5, null],
      ['/en/blog/read-a-lot/comments/', 1, null],
    ])
  })

  it('is unavailable when the deployment cannot read its analytics', async () => {
    const world = await newWorld(env.DB, 'stats-none')

    expect(await world.agent.contentStats({})).toEqual({ outcome: 'unavailable' })
  })
})
