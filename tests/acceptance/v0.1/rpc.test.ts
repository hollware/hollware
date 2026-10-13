import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../fixtures/content.ts'
import {
  agentWith,
  createDraft,
  createPlaygroundHarness,
  migrate,
  publishNew,
  seedOwnerToken,
  SITE_KEY,
  SITE_WORKER,
  siteFetch,
  type Agent,
} from './support/harness.ts'

// Fails when: a site stops reading what an agent published the way AC-0.1-5 describes, through
// the built example site and its service binding to the built playground: a published entry stops
// being served as the HTML of its stored document (the HTML that get_entry gives an agent); a draft
// or an unpublished entry becomes reachable; listEntries stops filtering by tag or stops taking a
// cursor to the next page; getTranslations stops giving the pair of a translation group; or the
// binding gains a method that writes.

const server = createPlaygroundHarness()
let agent: Agent
let edgeCachingId: string

/** The binding as the example site holds it, called from the test. */
interface Reader {
  listEntries(site: string, collection: string, options?: object): Promise<unknown>
  getEntry(site: string, collection: string, slug: string, locale: string): Promise<unknown>
  getTranslations(site: string, collection: string, group: string): Promise<unknown>
}

async function reader(): Promise<Reader> {
  const { HOLLWARE } = await server.getWorker<{ HOLLWARE: Reader }>(SITE_WORKER).getEnv()
  return HOLLWARE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `[locale, slug]` of each entry of a listing or a translation group. */
function keys(answer: unknown): [unknown, unknown][] {
  const entries = isRecord(answer) ? answer['entries'] : undefined
  if (!Array.isArray(entries)) throw new Error(`no entries: ${JSON.stringify(answer)}`)
  return entries.map((entry: unknown) =>
    isRecord(entry) ? [entry['locale'], entry['slug']] : [undefined, undefined],
  )
}

function cursorOf(answer: unknown): unknown {
  return isRecord(answer) ? answer['nextCursor'] : undefined
}

const corpus = (locale: 'en' | 'es', slug: string) => ({
  locale,
  slug,
  markdown: contentFixture(`blog/${locale}/${slug}.md`),
})

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  agent = agentWith(server, await seedOwnerToken(server))
  // Three English entries tagged cms, one of them with its Spanish translation; one more draft.
  edgeCachingId = await publishNew(agent, corpus('en', 'edge-caching-basics'))
  await publishNew(agent, corpus('es', 'cache-en-el-borde'))
  await publishNew(agent, corpus('en', 'agents-write-with-contracts'))
  await publishNew(agent, corpus('en', 'one-deployment-many-sites'))
  await createDraft(agent, corpus('en', 'markdown-as-source-of-truth'))
})

afterAll(async () => {
  await server.close()
})

describe('AC-0.1-5: a site reads Hollware over a service binding', () => {
  it('serves a published entry as the HTML of its stored document', async () => {
    const answer = await agent.call('get_entry', {
      collection: 'blog',
      locale: 'en',
      slug: 'edge-caching-basics',
      formats: ['html'],
    })
    const entry = answer.output['entry']
    const html = isRecord(entry) ? entry['html'] : undefined

    const page = await siteFetch(server, '/en/blog/edge-caching-basics/')

    expect(page.status).toBe(200)
    expect(typeof html === 'string' && html.length > 0).toBe(true)
    expect(await page.text()).toContain(`<article>\n${String(html)}\n</article>`)
  })

  it('answers 404 for a draft, as for an address with nothing behind it', async () => {
    const draft = await siteFetch(server, '/en/blog/markdown-as-source-of-truth/')
    const nothing = await siteFetch(server, '/en/blog/nothing-here/')

    expect([draft.status, nothing.status]).toEqual([404, 404])
    expect(await draft.text()).toBe(await nothing.text())
    expect(
      await (await reader()).getEntry(SITE_KEY, 'blog', 'markdown-as-source-of-truth', 'en'),
    ).toEqual({ outcome: 'not_found' })
  })

  it('lists the published entries of a tag, newest first, over two pages', async () => {
    const hollware = await reader()

    const first = await hollware.listEntries(SITE_KEY, 'blog', {
      locale: 'en',
      tag: 'cms',
      limit: 2,
    })
    const second = await hollware.listEntries(SITE_KEY, 'blog', {
      locale: 'en',
      tag: 'cms',
      limit: 2,
      cursor: cursorOf(first),
    })

    expect(keys(first)).toEqual([
      ['en', 'one-deployment-many-sites'],
      ['en', 'agents-write-with-contracts'],
    ])
    expect(keys(second)).toEqual([['en', 'edge-caching-basics']])
    expect(cursorOf(second)).toBe(null)
  })

  it('gives the Spanish and English entries of a translation group', async () => {
    const group = await (await reader()).getTranslations(SITE_KEY, 'blog', 'edge-caching')

    expect(keys(group).sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual([
      ['en', 'edge-caching-basics'],
      ['es', 'cache-en-el-borde'],
    ])
  })

  it('stops serving an entry once it is unpublished', async () => {
    const unpublished = await agent.call('unpublish', { id: edgeCachingId })

    expect(unpublished.output['outcome']).toBe('unpublished')
    expect((await siteFetch(server, '/en/blog/edge-caching-basics/')).status).toBe(404)
    expect(keys(await (await reader()).getTranslations(SITE_KEY, 'blog', 'edge-caching'))).toEqual([
      ['es', 'cache-en-el-borde'],
    ])
  })

  it.each(['createDraft', 'updateDraft', 'validate', 'publish', 'unpublish'])(
    'has no method that writes: %s',
    async (name) => {
      const { HOLLWARE } = await server
        .getWorker<{ HOLLWARE: Record<string, (...args: unknown[]) => Promise<unknown>> }>(
          SITE_WORKER,
        )
        .getEnv()

      // The stub throws as it is called, so the call goes inside a promise.
      const call = async () => HOLLWARE[name]?.(SITE_KEY)

      await expect(call()).rejects.toThrow(
        `The RPC receiver does not implement the method "${name}".`,
      )
    },
  )
})
