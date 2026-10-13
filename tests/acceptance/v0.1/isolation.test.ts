import type { TestHarness } from 'wrangler'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  agentWith,
  createPlaygroundHarness,
  migrate,
  seedForeignSite,
  seedOwnerToken,
  SITE_KEY,
  SITE_WORKER,
  type Agent,
  type ForeignEntry,
} from './support/harness.ts'

// Fails when: a site reaches the entries of another site of the same database, the way AC-0.1-13
// forbids: an operation of the playground's token, given the ids, slugs or translation group of
// the other site's entries, finds them, lists them or changes them, or a method of the binding
// finds them; or an entry of the other site keeps the playground from using the same slug.

const server = createPlaygroundHarness()
let agent: Agent
let foreign: ForeignEntry[]

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  agent = agentWith(server, await seedOwnerToken(server))
  foreign = await seedForeignSite(server, 'other-site')
})

afterAll(async () => {
  await server.close()
})

function entry(index: number): ForeignEntry {
  const found = foreign[index]
  if (found === undefined) throw new Error(`the other site has no entry ${index}`)
  return found
}

/** What the other site's entries are now: nothing the playground does may change them. */
async function foreignRows(harness: TestHarness): Promise<unknown> {
  const { DB } = await harness
    .getWorker<{
      DB: { prepare(sql: string): { all(): Promise<{ results: unknown[] }> } }
    }>()
    .getEnv()
  const { results } = await DB.prepare(
    "SELECT slug, status, version FROM entries WHERE site_id = 'other-site' ORDER BY slug",
  ).all()
  return results
}

const MARKDOWN =
  '---\ntitle: Edge caching basics\ndescription: The playground has its own.\ndate: 2026-10-13\ntags:\n  - cms\ntranslationGroup: edge-caching\n---\n\nThe playground writes its own.\n'

describe('AC-0.1-13: one site cannot reach another', () => {
  it.each([
    ['get_entry', () => ({ collection: 'blog', locale: 'en', slug: entry(0).slug })],
    ['get_translations', () => ({ collection: 'blog', translationGroup: 'edge-caching' })],
    ['update_draft', () => ({ id: entry(2).id, version: 1, markdown: MARKDOWN })],
    ['publish', () => ({ id: entry(2).id, version: 1 })],
    ['unpublish', () => ({ id: entry(0).id })],
  ])('%s with the ids of the other site answers not_found', async (tool, args) => {
    const answer = await agent.call(tool, args())

    expect([answer.isError, answer.output['outcome']]).toEqual([true, 'not_found'])
  })

  it('list_entries shows none of the other site entries', async () => {
    const all = await agent.call('list_entries', { collection: 'blog' })
    const published = await agent.call('list_entries', { collection: 'blog', status: 'published' })

    expect([all.output['entries'], published.output['entries']]).toEqual([[], []])
  })

  it('the binding finds none of them either', async () => {
    const { HOLLWARE } = await server
      .getWorker<{
        HOLLWARE: {
          getEntry(...args: unknown[]): Promise<unknown>
          getTranslations(...args: unknown[]): Promise<unknown>
          listEntries(...args: unknown[]): Promise<unknown>
        }
      }>(SITE_WORKER)
      .getEnv()

    expect(await HOLLWARE.getEntry(SITE_KEY, 'blog', entry(1).slug, 'es')).toEqual({
      outcome: 'not_found',
    })
    expect(await HOLLWARE.getTranslations(SITE_KEY, 'blog', 'edge-caching')).toEqual({
      outcome: 'not_found',
    })
    expect(await HOLLWARE.listEntries(SITE_KEY, 'blog')).toEqual({
      outcome: 'ok',
      entries: [],
      nextCursor: null,
    })
  })

  it('takes a slug and a translation group that the other site uses, and keeps them apart', async () => {
    const created = await agent.call('create_draft', {
      collection: 'blog',
      locale: 'en',
      slug: entry(0).slug,
      markdown: MARKDOWN,
    })
    const read = await agent.call('get_entry', {
      collection: 'blog',
      locale: 'en',
      slug: entry(0).slug,
    })

    expect(created.output['outcome']).toBe('saved')
    expect(read.output['entry']).toMatchObject({ markdown: MARKDOWN, version: 1 })
  })

  it('leaves every entry of the other site as it was', async () => {
    expect(await foreignRows(server)).toEqual([
      { slug: 'cache-en-el-borde', status: 'published', version: 1 },
      { slug: 'edge-caching-basics', status: 'published', version: 1 },
      { slug: 'from-draft-to-published', status: 'draft', version: 1 },
    ])
  })
})
