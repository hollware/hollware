import { describe, expect, it } from 'vite-plus/test'

import { hostsOf, pathOf, ranked, sinceOf } from '../../src/analytics/normalize.ts'

describe('the hosts of a site', () => {
  it('are the host of its url, then the ones the connection adds, lower case and once each', () => {
    expect(hostsOf('https://Example.com/blog/', ['www.example.com', 'example.com'])).toEqual([
      'example.com',
      'www.example.com',
    ])
    expect(hostsOf(null, ['docs.example.com'])).toEqual(['docs.example.com'])
    expect(hostsOf(null)).toEqual([])
  })

  it('refuses a name that is not a plain host, so none can break a query', () => {
    expect(() => hostsOf('https://example.com', ["x') OR 1=1 --"])).toThrow('Not a host name')
  })
})

describe('the paths of an answer', () => {
  it('lose their query, their fragment and their trailing slash, and keep the root', () => {
    expect(pathOf('/blog/edge/?utm=x#top')).toBe('/blog/edge')
    expect(pathOf('/')).toBe('/')
    expect(pathOf('/blog//')).toBe('/blog')
  })

  it('lose their trailing slashes in linear time, as a provider answers what visitors asked', () => {
    const started = performance.now()
    expect(pathOf(`/a${'/'.repeat(40_000)}a`)).toHaveLength(40_003)
    expect(performance.now() - started).toBeLessThan(50)
  })

  it('are not pages when they are Cloudflare paths, another host or not a path', () => {
    expect(pathOf('/cdn-cgi/rum')).toBeNull()
    expect(pathOf('/cdn-cgi')).toBeNull()
    expect(pathOf('//evil.example/x')).toBeNull()
    expect(pathOf('blog/x')).toBeNull()
  })

  it('merge into one page, most read first, within the limit after merging', () => {
    expect(
      ranked(
        [
          { path: '/a/', views: 3 },
          { path: '/a', views: 2 },
          { path: '/b?x=1', views: 4 },
          { path: '/cdn-cgi/rum', views: 99 },
          { path: '/c', views: 0 },
          { path: '/d', views: Number.NaN },
          { path: '/e', views: 1 },
        ],
        2,
      ),
    ).toEqual([
      { path: '/a', views: 5 },
      { path: '/b', views: 4 },
    ])
  })
})

describe('the first day of a count', () => {
  it('is `days` before now, as a day in UTC', () => {
    expect(sinceOf(new Date('2026-10-21T02:00:00.000Z'), 30)).toBe('2026-09-21')
  })
})
