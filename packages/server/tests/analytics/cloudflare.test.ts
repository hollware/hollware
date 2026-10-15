import { describe, expect, it } from 'vite-plus/test'

import {
  analyticsReaderOf,
  analyticsWriterOf,
  sqlApiReader,
  topPagesSql,
} from '../../src/analytics/cloudflare.ts'

// Fails when: the query of content_stats (topPagesSql, src/analytics/cloudflare.ts) stops being
// the one below, or stops refusing a value that could carry SQL (the SQL API takes no
// parameters); the reader stops asking the account's SQL API with the token, stops reading
// `data` back with its views as numbers, stops keeping an answer in the cache and serving the next
// call from it, or takes a failed answer for an empty one; or the Worker's variables make a reader
// or a writer without what each needs.

describe('topPagesSql', () => {
  it('counts the views of each path of the site over the days, sampling accounted for', () => {
    expect(topPagesSql('hollware_page_views', 'blog', { days: 30, limit: 10 })).toBe(
      "SELECT blob1 AS path, SUM(_sample_interval) AS views FROM hollware_page_views WHERE index1 = 'blog' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY path ORDER BY views DESC LIMIT 10 FORMAT JSON",
    )
  })

  it('refuses every value that is not what it must be', () => {
    const ok = { days: 30, limit: 10 }

    expect(() => topPagesSql('hollware_page_views', "blog' OR '1'='1", ok)).toThrow('No site key')
    expect(() => topPagesSql('views; DROP', 'blog', ok)).toThrow('No dataset')
    expect(() => topPagesSql('hollware_page_views', 'blog', { days: 1.5, limit: 10 })).toThrow(
      '1.5 days',
    )
    expect(() => topPagesSql('hollware_page_views', 'blog', { days: 30, limit: 51 })).toThrow(
      '51 pages',
    )
  })
})

function memoryCache() {
  const kept = new Map<string, string>()
  return {
    kept,
    cache: {
      async match(request: RequestInfo | URL) {
        const text = kept.get(new Request(request).url)
        return text === undefined ? undefined : new Response(text)
      },
      async put(request: RequestInfo | URL, response: Response) {
        kept.set(new Request(request).url, await response.text())
      },
    },
  }
}

describe('the SQL API reader', () => {
  it('asks the account with the token, reads the views as numbers, and keeps the answer', async () => {
    const sent: { url: string; auth: string | null; body: string }[] = []
    const { cache, kept } = memoryCache()
    const reader = sqlApiReader({
      accountId: 'acc123',
      token: 'secret-token',
      dataset: 'hollware_page_views',
      cache,
      fetch: async (request) => {
        sent.push({
          url: request.url,
          auth: request.headers.get('authorization'),
          body: await request.text(),
        })
        return Response.json({
          data: [
            { path: '/blog/a/', views: '12' },
            { path: '/', views: 3 },
          ],
        })
      },
    })

    const first = await reader.topPages('blog', { days: 7, limit: 2 })
    const second = await reader.topPages('blog', { days: 7, limit: 2 })

    expect(first).toEqual([
      { path: '/blog/a/', views: 12 },
      { path: '/', views: 3 },
    ])
    expect(second).toEqual(first)
    expect(sent.map(({ url, auth }) => [url, auth])).toEqual([
      [
        'https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql',
        'Bearer secret-token',
      ],
    ])
    expect(sent[0]?.body).toBe(topPagesSql('hollware_page_views', 'blog', { days: 7, limit: 2 }))
    expect([...kept.keys()]).toEqual([
      'https://hollware.invalid/content-stats/hollware_page_views/blog?days=7&limit=2',
    ])
  })

  it('takes a failed answer for an error, and keeps nothing', async () => {
    const { cache, kept } = memoryCache()
    const reader = sqlApiReader({
      accountId: 'acc123',
      token: 'secret-token',
      dataset: 'hollware_page_views',
      cache,
      fetch: async () => new Response('denied', { status: 403 }),
    })

    await expect(reader.topPages('blog', { days: 7, limit: 2 })).rejects.toThrow(
      'The SQL API of Analytics Engine answered 403',
    )
    expect(kept.size).toBe(0)
  })
})

describe('the analytics of the Worker', () => {
  it('reads with an account and a token, and writes with a binding', () => {
    const binding = { writeDataPoint: () => undefined }

    expect(analyticsReaderOf({})).toBeNull()
    expect(analyticsReaderOf({ HOLLWARE_ANALYTICS_ACCOUNT_ID: 'acc' })).toBeNull()
    expect(analyticsReaderOf({ HOLLWARE_ANALYTICS_TOKEN: 'token' })).toBeNull()
    expect(
      analyticsReaderOf({
        HOLLWARE_ANALYTICS_ACCOUNT_ID: 'acc',
        HOLLWARE_ANALYTICS_TOKEN: 'token',
      }),
    ).not.toBeNull()
    expect(analyticsWriterOf({})).toBeNull()
    expect(analyticsWriterOf({ ANALYTICS: binding })).not.toBeNull()
  })
})
