import { createClient, type HollwareReader } from '@hollware/client'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../../../tests/fixtures/content.ts'
import {
  agentWith,
  createDraft,
  migrate,
  previewTokenFor,
  publishNew,
  seedOwnerToken,
  SITE_KEY,
} from './support.ts'
import { createPlaygroundHarness, HOLLWARE_URL, SITE_WORKER } from './workers.ts'

// Fails when: @hollware/client stops reading the same published content over a service binding
// and over HTTP (one suite, both transports), or the read API of the built Worker (src/http/
// read-api.ts) stops serving the five read methods at /v1 (search included) to a token with content:read, passing
// on a search's mode (refusing one it does not know) and get_entry's related, stops answering an
// input the caller got wrong with its code and status (400 or 404) instead of a 500, stops
// answering 304 to its own ETag, stops refusing a request without a token or one that writes, or
// stops describing its routes in /v1/openapi.json.

const server = createPlaygroundHarness()
let token = ''
let draftId = ''

const corpus = (locale: 'en' | 'es', slug: string) => ({
  locale,
  slug,
  markdown: contentFixture(`blog/${locale}/${slug}.md`),
})

/** The built Worker over HTTP, as a site outside Cloudflare reaches it. */
async function viaHttp(request: Request): Promise<Response> {
  const answer = await server.fetch(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers),
  })
  return new Response(answer.status === 304 ? null : await answer.text(), {
    status: answer.status,
    headers: Object.fromEntries(answer.headers),
  })
}

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  token = await seedOwnerToken(server)
  const agent = agentWith(server, token)
  await publishNew(agent, corpus('en', 'edge-caching-basics'))
  await publishNew(agent, corpus('es', 'cache-en-el-borde'))
  draftId = (await createDraft(agent, corpus('en', 'markdown-as-source-of-truth'))).id
})

afterAll(async () => {
  await server.close()
})

async function readers(): Promise<[string, HollwareReader][]> {
  const { HOLLWARE } = await server.getWorker<{ HOLLWARE: HollwareReader }>(SITE_WORKER).getEnv()
  return [
    ['a service binding', createClient({ binding: HOLLWARE })],
    ['HTTP', createClient({ url: HOLLWARE_URL, token, fetch: viaHttp })],
  ]
}

describe('@hollware/client', () => {
  it('reads the same published content over a binding and over HTTP', async () => {
    for (const [transport, client] of await readers()) {
      const entry = await client.getEntry(SITE_KEY, 'blog', 'edge-caching-basics', 'en', {
        formats: ['html'],
      })
      const draft = await client.getEntry(SITE_KEY, 'blog', 'markdown-as-source-of-truth', 'en')
      const listed = await client.listEntries(SITE_KEY, 'blog', { locale: 'en' })
      const group = await client.getTranslations(SITE_KEY, 'blog', 'edge-caching')
      const site = await client.describeSite(SITE_KEY)
      // A word of the Spanish post, written without its accent; the draft is never found.
      const found = await client.search(SITE_KEY, 'cache borde', { locale: 'es' })
      const unpublished = await client.search(SITE_KEY, 'source truth')
      // The playground has no AI or Vectorize binding: every search is full text, and says so.
      const meaning = await client.search(SITE_KEY, 'cache borde', { mode: 'semantic' })
      const related = await client.getEntry(SITE_KEY, 'blog', 'edge-caching-basics', 'en', {
        related: true,
      })
      let unknownMode = 'answered'
      try {
        await client.search(SITE_KEY, 'cache', JSON.parse('{"mode":"vibes"}'))
      } catch (error) {
        unknownMode = error instanceof Error ? error.message : String(error)
      }

      expect(
        [
          entry.outcome,
          entry.entry?.slug,
          entry.entry?.html?.startsWith('<h1'),
          draft.outcome,
          listed.entries?.map(({ slug }) => slug),
          group.entries?.map(({ locale }) => locale).sort(),
          site.site.key,
          found.results.map(({ entry: { slug } }) => slug),
          found.results[0]?.snippet.includes('['),
          unpublished.results,
          meaning.mode,
          meaning.results.map(({ entry: { slug } }) => slug),
          related.related,
          unknownMode.includes('mode'),
        ],
        transport,
      ).toEqual([
        'ok',
        'edge-caching-basics',
        true,
        'not_found',
        ['edge-caching-basics'],
        ['en', 'es'],
        'playground',
        ['cache-en-el-borde'],
        true,
        [],
        'fulltext',
        ['cache-en-el-borde'],
        [],
        true,
      ])
    }
  })
})

describe('the read API', () => {
  const get = (path: string, headers: Record<string, string> = {}) =>
    server.fetch(`${HOLLWARE_URL}${path}`, {
      headers: { authorization: `Bearer ${token}`, ...headers },
    })

  it('says how long the read took on the server', async () => {
    const answer = await get('/v1/blog/en/edge-caching-basics')

    expect(answer.headers.get('server-timing')).toMatch(/^read;dur=\d+$/)
  })

  it('answers 304 to its own ETag, and 200 to another', async () => {
    const first = await get('/v1/blog/en/edge-caching-basics')
    const etag = first.headers.get('etag') ?? ''
    const again = await get('/v1/blog/en/edge-caching-basics', { 'if-none-match': etag })
    const other = await get('/v1/blog/en/edge-caching-basics', { 'if-none-match': 'W/"other"' })

    expect([first.status, etag.startsWith('W/"'), again.status, other.status]).toEqual([
      200,
      true,
      304,
      200,
    ])
  })

  it('answers what the caller got wrong with its code and status, never as a failure of its own', async () => {
    const statuses: [string, number, unknown][] = []
    for (const path of [
      '/v1/nope',
      '/v1/blog?limit=0',
      '/v1/blog/xx/edge-caching-basics',
      '/v1/search?q=cache&mode=vibes',
    ]) {
      const response = await get(path)
      const body: unknown = await response.json()
      statuses.push([
        path,
        response.status,
        typeof body === 'object' && body !== null && 'code' in body ? body.code : null,
      ])
    }

    expect(statuses).toEqual([
      ['/v1/nope', 404, 'unknown_collection'],
      ['/v1/blog?limit=0', 400, 'invalid_input'],
      ['/v1/blog/xx/edge-caching-basics', 404, 'unknown_locale'],
      ['/v1/search?q=cache&mode=vibes', 400, 'invalid_input'],
    ])
  })

  it('refuses a request without a token, and one that writes', async () => {
    const anonymous = await server.fetch(`${HOLLWARE_URL}/v1/site`)
    const write = await server.fetch(`${HOLLWARE_URL}/v1/blog`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })

    expect([anonymous.status, write.status]).toEqual([401, 405])
  })

  it('describes its five routes in OpenAPI 3.1', async () => {
    const document: unknown = await (await get('/v1/openapi.json')).json()

    expect(document).toMatchObject({ openapi: '3.1.0' })
    expect(
      typeof document === 'object' && document !== null && 'paths' in document
        ? Object.keys(Object(document.paths))
        : [],
    ).toEqual([
      '/v1/site',
      '/v1/search',
      '/v1/{collection}',
      '/v1/{collection}/translations/{group}',
      '/v1/{collection}/{locale}/{slug}',
    ])
  })

  it('reads a draft with a preview token, and refuses a token that is expired or forged', async () => {
    for (const [transport, client] of await readers()) {
      const slug = 'markdown-as-source-of-truth'
      const previewed = await client.getEntry(SITE_KEY, 'blog', slug, 'en', {
        preview: await previewTokenFor(draftId),
      })
      const refused = async (preview: string) => {
        try {
          await client.getEntry(SITE_KEY, 'blog', slug, 'en', { preview })
          return 'answered'
        } catch (error) {
          // A binding's error says its class; HTTP's does not: the message is the same.
          return (error instanceof Error ? error.message : String(error)).replace(
            /^HollwareError: /,
            '',
          )
        }
      }

      expect(
        [
          previewed.outcome,
          previewed.entry?.slug,
          previewed.entry?.status,
          await refused(await previewTokenFor(draftId, { ageSeconds: 3601 })),
          await refused(await previewTokenFor(draftId, { secret: 'x'.repeat(40) })),
        ],
        transport,
      ).toEqual([
        'ok',
        slug,
        'draft',
        'This preview link has expired.',
        'This preview link is not valid.',
      ])
    }
  })
})
