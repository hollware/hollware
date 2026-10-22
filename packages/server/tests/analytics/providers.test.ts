import { describe, expect, it } from 'vite-plus/test'

import { cloudflareSource } from '../../src/analytics/cloudflare.ts'
import { ga4Source, signedAssertion, serviceAccountOf } from '../../src/analytics/ga4.ts'
import { plausibleSource } from '../../src/analytics/plausible.ts'
import { pagesHogql, posthogSource } from '../../src/analytics/posthog.ts'
import { OPEN_WORLD_TIMEOUT_MS } from '../../src/limits.ts'
import {
  messageOf,
  ProviderError,
  request,
  REQUEST_TIMEOUT_MS,
  type Fetch,
} from '../../src/analytics/request.ts'
import type { SourceInput } from '../../src/analytics/source.ts'

// Fails when: an adapter of ADR-040 stops asking its provider as its API wants it (the endpoint,
// the credential as a bearer token, the site's hosts, the days and the limit), stops reading the
// answer into normalized paths and views, stops finding what the credential shows (Cloudflare's
// one account, PostHog's region and project), stops turning a refusal into `refused` with the
// permission to add or a bad setting into `invalid`, lets a provider's message repeat the
// credential, GA4 stops signing its JWT with the service account's key, or a provider stops
// getting 25 s, inside the 30 s of its operation, before it is `unreachable`.

const NOW = () => new Date('2026-10-21T12:00:00.000Z')

/** A provider that answers each request with the next of `answers`, and records what it was asked. */
function provider(...answers: { status: number; body: unknown }[]) {
  const asked: { url: string; method: string; headers: Record<string, string>; body: unknown }[] =
    []
  const fetch: Fetch = async (url, init) => {
    const text = typeof init?.body === 'string' ? init.body : ''
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // A form or no body: kept as text.
    }
    asked.push({
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    })
    const answer = answers.shift()
    if (answer === undefined) throw new Error(`no answer left for ${url}`)
    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }
  return { fetch, asked }
}

const input = (fetch: Fetch, over: Partial<SourceInput> = {}): SourceInput => ({
  fetch,
  credential: 'secret-credential-value',
  settings: {},
  hosts: ['example.com', 'www.example.com'],
  now: NOW,
  ...over,
})

async function failure(work: Promise<unknown>): Promise<ProviderError> {
  try {
    await work
  } catch (error) {
    if (error instanceof ProviderError) return error
    throw error
  }
  throw new Error('it did not fail')
}

describe('Cloudflare Web Analytics', () => {
  it('asks GraphQL for the page loads of the hosts, in the account it is given', async () => {
    const cf = provider({
      status: 200,
      body: {
        data: {
          viewer: {
            accounts: [
              {
                pages: [
                  { count: 150, dimensions: { requestPath: '/' } },
                  { count: 30, dimensions: { requestPath: '/blog/edge/' } },
                  { count: 10, dimensions: { requestPath: '/cdn-cgi/rum' } },
                ],
              },
            ],
          },
        },
      },
    })
    const settings = { accountId: 'a'.repeat(32) }

    const found = await cloudflareSource(input(cf.fetch, { settings })).discover()
    const pages = await cloudflareSource(input(cf.fetch, { settings })).topPages(7, 5)

    expect(found).toEqual(settings)
    expect(cf.asked).toHaveLength(1)
    expect(cf.asked[0]?.url).toBe('https://api.cloudflare.com/client/v4/graphql')
    expect(cf.asked[0]?.headers['authorization']).toBe('Bearer secret-credential-value')
    expect(cf.asked[0]?.body).toMatchObject({
      variables: {
        account: 'a'.repeat(32),
        since: '2026-10-14',
        hosts: ['example.com', 'www.example.com'],
      },
    })
    expect(JSON.stringify(cf.asked[0]?.body)).toContain('limit: 15')
    expect(pages).toEqual([
      { path: '/', views: 150 },
      { path: '/blog/edge', views: 30 },
    ])
  })

  it('needs the account, which its token cannot list, and refuses a token without the permission', async () => {
    const none = provider()
    const denied = provider({
      status: 200,
      body: { data: null, errors: [{ message: 'not authorized for that account' }] },
    })

    const missing = await failure(cloudflareSource(input(none.fetch)).discover())
    const refused = await failure(
      cloudflareSource(input(denied.fetch, { settings: { accountId: 'b'.repeat(32) } })).topPages(
        7,
        5,
      ),
    )

    expect(missing.kind).toBe('invalid')
    expect(missing.fix).toContain('dash.cloudflare.com')
    expect(none.asked).toEqual([])
    expect(refused.kind).toBe('refused')
    expect(refused.fix).toContain('Account Analytics Read')
  })
})

describe('PostHog', () => {
  it('finds the region and the project of the key at @current, and counts $pageview by $pathname', async () => {
    const ph = provider(
      {
        status: 401,
        body: { detail: 'Personal API key found in request Authorization header is invalid.' },
      },
      { status: 200, body: { id: 521024, name: 'Default project' } },
      {
        status: 200,
        body: {
          columns: ['path', 'views'],
          results: [
            ['/en/blog/oxlint/', 123],
            ['/', 62],
          ],
        },
      },
    )

    const settings = await posthogSource(input(ph.fetch)).discover()
    const pages = await posthogSource(input(ph.fetch, { settings })).topPages(30, 10)

    expect(ph.asked.map((ask) => ask.url)).toEqual([
      'https://us.posthog.com/api/projects/@current/',
      'https://eu.posthog.com/api/projects/@current/',
      'https://eu.posthog.com/api/projects/521024/query/',
    ])
    expect(settings).toEqual({ host: 'https://eu.posthog.com', projectId: 521024 })
    expect(ph.asked[2]?.body).toEqual({
      query: {
        kind: 'HogQLQuery',
        query:
          "SELECT properties.$pathname AS path, count() AS views FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 30 DAY AND properties.$host IN ('example.com', 'www.example.com') GROUP BY path ORDER BY views DESC LIMIT 30",
      },
    })
    expect(pages).toEqual([
      { path: '/en/blog/oxlint', views: 123 },
      { path: '/', views: 62 },
    ])
  })

  it('refuses a key unknown in both regions, and one without Query read with that scope as the fix', async () => {
    const unknown = provider({ status: 401, body: {} }, { status: 401, body: {} })
    const noQuery = provider({ status: 403, body: { detail: 'API key missing required scope' } })

    expect((await failure(posthogSource(input(unknown.fetch)).discover())).kind).toBe('refused')
    const refused = await failure(
      posthogSource(
        input(noQuery.fetch, { settings: { host: 'https://us.posthog.com', projectId: 1 } }),
      ).topPages(7, 5),
    )
    expect(refused.kind).toBe('refused')
    expect(refused.fix).toContain('Query: read')
  })

  it('builds its HogQL from checked values only', () => {
    expect(() => pagesHogql(["evil') OR 1=1 --"], 7, 5)).toThrow('Not a host name')
    expect(() => pagesHogql(['example.com'], 0, 5)).toThrow('Not a number of days')
  })
})

describe('Plausible', () => {
  it('asks the Stats API v2 for pageviews by event:page of the site id, the host of its url by default', async () => {
    const pl = provider({
      status: 200,
      body: {
        results: [
          { metrics: [40], dimensions: ['/blog/a/'] },
          { metrics: [3], dimensions: ['/blog/a'] },
        ],
      },
    })

    const settings = await plausibleSource(input(pl.fetch)).discover()
    const pages = await plausibleSource(input(pl.fetch, { settings })).topPages(7, 5)

    expect(settings).toEqual({ host: 'https://plausible.io', siteId: 'example.com' })
    expect(pl.asked[0]?.url).toBe('https://plausible.io/api/v2/query')
    expect(pl.asked[0]?.body).toEqual({
      site_id: 'example.com',
      metrics: ['pageviews'],
      date_range: ['2026-10-14', '2026-10-21'],
      dimensions: ['event:page'],
      order_by: [['pageviews', 'desc']],
      pagination: { limit: 15 },
    })
    expect(pages).toEqual([{ path: '/blog/a', views: 43 }])
  })

  it('refuses a key that is not a Stats API key, and calls a site it does not know invalid', async () => {
    const denied = provider({ status: 401, body: { error: 'Invalid API key' } })
    const unknown = provider({ status: 400, body: { error: 'Site not found' } })

    expect((await failure(plausibleSource(input(denied.fetch)).topPages(7, 5))).kind).toBe(
      'refused',
    )
    expect((await failure(plausibleSource(input(unknown.fetch)).topPages(7, 5))).kind).toBe(
      'invalid',
    )
  })
})

async function serviceAccountKey() {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )
  if (!('privateKey' in pair)) throw new Error('RSA makes a pair of keys')
  const exported = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  if (!(exported instanceof ArrayBuffer)) throw new Error('pkcs8 exports bytes')
  const pkcs8 = new Uint8Array(exported)
  const body = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, '$1\n')
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`
  const credential = JSON.stringify({
    type: 'service_account',
    client_email: 'reader@project.iam.gserviceaccount.com',
    private_key: pem,
  })
  return { credential, publicKey: pair.publicKey }
}

const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

describe('GA4', () => {
  it('signs a JWT for analytics.readonly with the key of the service account', async () => {
    const { credential, publicKey } = await serviceAccountKey()

    const jwt = await signedAssertion(serviceAccountOf(credential), NOW())
    const [header, claims, signature] = jwt.split('.')

    expect(JSON.parse(new TextDecoder().decode(fromBase64url(header ?? '')))).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(claims ?? '')))).toEqual({
      iss: 'reader@project.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_792_584_000,
      exp: 1_792_587_600,
    })
    expect(
      await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKey,
        fromBase64url(signature ?? ''),
        new TextEncoder().encode(`${header}.${claims}`),
      ),
    ).toBe(true)
  })

  it('trades the JWT for a token, and runs a report of screenPageViews by pagePath for the hosts', async () => {
    const { credential } = await serviceAccountKey()
    const google = provider(
      { status: 200, body: { access_token: 'ya29.token' } },
      {
        status: 200,
        body: {
          rows: [
            { dimensionValues: [{ value: '/guide/' }], metricValues: [{ value: '91' }] },
            { dimensionValues: [{ value: '/' }], metricValues: [{ value: '12' }] },
          ],
        },
      },
    )

    const pages = await ga4Source(
      input(google.fetch, { credential, settings: { propertyId: '123456789' } }),
    ).topPages(28, 5)

    expect(google.asked[0]?.url).toBe('https://oauth2.googleapis.com/token')
    expect(String(google.asked[0]?.body)).toContain(
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer',
    )
    expect(google.asked[1]?.url).toBe(
      'https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport',
    )
    expect(google.asked[1]?.headers['authorization']).toBe('Bearer ya29.token')
    expect(google.asked[1]?.body).toMatchObject({
      dateRanges: [{ startDate: '28daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [{ name: 'screenPageViews' }],
      dimensionFilter: {
        filter: {
          fieldName: 'hostName',
          inListFilter: { values: ['example.com', 'www.example.com'] },
        },
      },
    })
    expect(pages).toEqual([
      { path: '/guide', views: 91 },
      { path: '/', views: 12 },
    ])
  })

  it('names the service account to add as a Viewer when the property refuses it, and reads no other JSON', async () => {
    const { credential } = await serviceAccountKey()
    const google = provider(
      { status: 200, body: { access_token: 'ya29.token' } },
      { status: 403, body: { error: { message: 'User does not have sufficient permissions.' } } },
    )

    const refused = await failure(
      ga4Source(input(google.fetch, { credential, settings: { propertyId: '1' } })).topPages(7, 5),
    )

    expect(refused.kind).toBe('refused')
    expect(refused.fix).toContain('reader@project.iam.gserviceaccount.com')
    expect(() => serviceAccountOf('{"type":"user"}')).toThrow(ProviderError)
    expect(() => serviceAccountOf('not json')).toThrow('not JSON')
  })
})

describe('what a provider said', () => {
  it('never repeats the credential, and keeps to 300 characters', () => {
    expect(
      messageOf({ detail: 'Bad key secret-credential-value here' }, ['secret-credential-value']),
    ).toBe('Bad key [credential] here')
    expect(messageOf({ errors: [{ message: 'x'.repeat(400) }] }, [])).toHaveLength(300)
    expect(messageOf({}, [])).toBe('No reason given.')
  })
})

describe('a provider that does not answer', () => {
  it('is unreachable after 25 s, before the open-world operation times out', async () => {
    const signals: (AbortSignal | null | undefined)[] = []
    const silent: Fetch = async (_url, init) => {
      signals.push(init?.signal)
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }

    const failure = await request(silent, 'posthog', 'https://us.posthog.com/', {}).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(ProviderError)
    expect(failure).toMatchObject({
      kind: 'unreachable',
      message: 'posthog did not answer in 25 s.',
    })
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(OPEN_WORLD_TIMEOUT_MS)
  })
})
