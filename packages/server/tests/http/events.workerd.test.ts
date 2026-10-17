import { defineCollection, defineConfig } from '@hollware/core'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { boot, SITE_KEY } from './support.ts'

// Fails when: the beacon (`POST /events`, src/http/events.ts) stops counting a view of a page of
// the site (its url or its cors.origins) with the site, the path without its query and the
// country, and nothing else; stops refusing a page of another origin, a request with no origin,
// a body that names no site or no path, or one too large, read no further than its limit; answers
// a site it does not serve as it answers another origin (T-09); or the guard's exception for it
// (src/http/gateway.ts) lets a page of a site's origin reach anything but `POST /events`.

const OTHER = 'other-blog'

const CONFIG = defineConfig({
  sites: {
    [SITE_KEY]: {
      locales: ['en'],
      defaultLocale: 'en',
      url: 'https://blog.test',
      cors: { origins: ['https://preview.test'] },
      collections: {
        blog: defineCollection({
          schema: z.object({ title: z.string().min(1) }),
          routes: { en: '/blog/:slug/' },
        }),
      },
    },
    [OTHER]: {
      locales: ['en'],
      defaultLocale: 'en',
      url: 'https://other.test',
      collections: {
        blog: defineCollection({
          schema: z.object({ title: z.string().min(1) }),
          routes: { en: '/blog/:slug/' },
        }),
      },
    },
  },
})

function withAnalytics() {
  const points: unknown[] = []
  const worker = boot({
    config: CONFIG,
    bindings: {
      ANALYTICS: {
        writeDataPoint: (point) => {
          points.push(point)
        },
      },
    },
  })
  const beacon = (origin: string | null, body: string) =>
    worker.send('/events', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain;charset=UTF-8',
        ...(origin === null ? {} : { origin }),
      },
      body,
    })
  return { worker, points, beacon }
}

const view = (path: string, site: string = SITE_KEY) => JSON.stringify({ site, path })

async function codeOf(response: Response): Promise<[number, unknown]> {
  const body: unknown = await response.json()
  return [
    response.status,
    typeof body === 'object' && body !== null && 'code' in body ? body.code : null,
  ]
}

describe('the beacon', () => {
  it('counts a view from a page of the site: the site, the path without its query, the country', async () => {
    const { points, beacon } = withAnalytics()

    const own = await beacon('https://blog.test', view('/blog/edge/?utm_source=x#top'))
    const preview = await beacon('https://preview.test', view('/'))

    expect([own.status, preview.status]).toEqual([204, 204])
    expect(points).toEqual([
      { indexes: [SITE_KEY], blobs: ['/blog/edge/', 'XX'], doubles: [1] },
      { indexes: [SITE_KEY], blobs: ['/', 'XX'], doubles: [1] },
    ])
  })

  it('takes the country from what Cloudflare says of the request', async () => {
    const { worker, points } = withAnalytics()

    await worker.sendRequest(
      new Request('https://hollware.test/events', {
        method: 'POST',
        headers: { origin: 'https://blog.test' },
        body: view('/'),
        cf: { country: 'CL' },
      }),
    )

    expect(points).toEqual([{ indexes: [SITE_KEY], blobs: ['/', 'CL'], doubles: [1] }])
  })

  it('refuses a page of another site, a request with no origin, and a page of no site', async () => {
    const { points, beacon } = withAnalytics()

    const answers = [
      await codeOf(await beacon('https://other.test', view('/blog/edge/'))),
      await codeOf(await beacon(null, view('/blog/edge/'))),
      await codeOf(await beacon('https://evil.test', view('/blog/edge/'))),
    ]

    expect(answers).toEqual([
      [403, 'forbidden_origin'],
      [403, 'forbidden_origin'],
      [403, 'forbidden_origin'],
    ])
    expect(points).toEqual([])
  })

  it('refuses a body with no site it serves, no path, or too many bytes', async () => {
    const { points, beacon } = withAnalytics()

    const answers = [
      await codeOf(await beacon('https://blog.test', view('/a/', 'nope'))),
      await codeOf(await beacon('https://blog.test', view('https://evil.test/a/'))),
      await codeOf(await beacon('https://blog.test', 'not json')),
      await codeOf(await beacon('https://blog.test', view(`/${'a'.repeat(3000)}`))),
    ]

    expect(answers).toEqual([
      [403, 'forbidden_origin'],
      [400, 'invalid_input'],
      [400, 'invalid_input'],
      [413, 'too_large'],
    ])
    expect(points).toEqual([])
  })

  it('answers a site it does not serve as it answers a page of another origin (T-09)', async () => {
    const { beacon } = withAnalytics()

    const unknown = await beacon('https://blog.test', view('/a/', 'nope'))
    const elsewhere = await beacon('https://evil.test', view('/a/'))

    expect([unknown.status, await unknown.text()]).toEqual([
      elsewhere.status,
      await elsewhere.text(),
    ])
    expect(unknown.status).toBe(403)
  })

  it('refuses a body that says it is too large before reading it (T-08)', async () => {
    const { worker, points } = withAnalytics()

    const answer = await worker.send('/events', {
      method: 'POST',
      headers: { origin: 'https://blog.test', 'content-length': '1000000' },
      body: view('/a/'),
    })

    expect(await codeOf(answer)).toEqual([413, 'too_large'])
    expect(points).toEqual([])
  })

  it('answers 204 when the Worker counts nothing', async () => {
    const worker = boot({ config: CONFIG })

    const answer = await worker.send('/events', {
      method: 'POST',
      headers: { origin: 'https://blog.test' },
      body: view('/'),
    })

    expect(answer.status).toBe(204)
  })

  it('lets a page of the site reach POST /events and nothing else', async () => {
    const { worker } = withAnalytics()
    const from = { origin: 'https://blog.test' }

    const answers = [
      await codeOf(await worker.send('/mcp', { method: 'POST', headers: from, body: '{}' })),
      await codeOf(await worker.send('/v1/site', { headers: from })),
      await codeOf(await worker.send('/events', { headers: from })),
    ]

    expect(answers).toEqual([
      [403, 'forbidden_origin'],
      [403, 'forbidden_origin'],
      [403, 'forbidden_origin'],
    ])
  })
})
