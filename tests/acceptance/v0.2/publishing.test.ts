import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'

import { contentFixture } from '../../fixtures/content.ts'
import {
  agentWith,
  createPlaygroundHarness,
  migrate,
  seedOwnerToken,
  type Agent,
} from '../v0.1/support/harness.ts'

const server = createPlaygroundHarness()
let agent: Agent

const SLUGS = {
  en: [
    'agents-write-with-contracts',
    'edge-caching-basics',
    'from-draft-to-published',
    'markdown-as-source-of-truth',
    'one-deployment-many-sites',
  ],
  es: [
    'agentes-que-escriben-con-contratos',
    'cache-en-el-borde',
    'del-borrador-a-publicado',
    'markdown-como-fuente-de-verdad',
    'un-despliegue-muchos-sitios',
  ],
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function entryOf(output: Record<string, unknown>): {
  id: string
  version: number
  status: unknown
} {
  const entry = output['entry']
  if (!isRecord(entry) || typeof entry['id'] !== 'string' || typeof entry['version'] !== 'number') {
    throw new Error(`no entry: ${JSON.stringify(output)}`)
  }
  return { id: entry['id'], version: entry['version'], status: entry['status'] }
}

async function database() {
  const env = await server
    .getWorker<{ DB: { prepare(sql: string): { all(): Promise<{ results: unknown[] }> } } }>()
    .getEnv()
  return env.DB
}

async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5000
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

beforeAll(async () => {
  await server.listen()
  await migrate(server)
  agent = agentWith(server, await seedOwnerToken(server))
})

afterAll(async () => {
  await server.close()
})

describe('AC-0.2-3: entries that link to each other publish together', () => {
  it('publishes the corpus in one step, which no entry of it can alone', async () => {
    const drafts = []
    for (const locale of ['en', 'es'] as const) {
      for (const slug of SLUGS[locale]) {
        const created = await agent.call('create_draft', {
          collection: 'blog',
          locale,
          slug,
          markdown: contentFixture(`blog/${locale}/${slug}.md`),
        })
        drafts.push(entryOf(created.output))
      }
    }
    const [first, ...rest] = drafts
    if (first === undefined) throw new Error('no drafts')

    const alone = await agent.call('publish', { id: first.id, version: first.version })
    const together = await agent.call('publish', {
      id: first.id,
      version: first.version,
      group: rest.map(({ id, version }) => ({ id, version })),
    })
    const listed = await agent.call('list_entries', {
      collection: 'blog',
      status: 'published',
      limit: 20,
    })

    expect(alone.output['outcome']).toBe('needs_acknowledgement')
    expect(together.output['outcome']).toBe('published')
    expect(Array.isArray(listed.output['entries']) ? listed.output['entries'].length : 0).toBe(10)
  })

  it('puts the events of the publications on the Queue', async () => {
    const db = await database()

    const rows = await eventually(
      async () =>
        (await db.prepare("SELECT kind, sent_at FROM outbox WHERE kind = 'entry.published'").all())
          .results,
      (results) =>
        results.length === 10 && results.every((row) => isRecord(row) && row['sent_at'] !== null),
    )

    expect(rows.length).toBe(10)
    expect(rows.every((row) => isRecord(row) && typeof row['sent_at'] === 'string')).toBe(true)
  })
})

describe('AC-0.2-2: a scheduled publication', () => {
  it('waits as scheduled, and the cron trigger publishes it once its time has passed', async () => {
    const markdown = `---\ntitle: A post for later\ndescription: Published by the cron trigger.\ndate: 2026-10-14\ntags:\n  - cms\ntranslationGroup: later\n---\n\nLater.\n`
    const created = await agent.call('create_draft', {
      collection: 'blog',
      locale: 'en',
      slug: 'later',
      markdown,
    })
    const { id, version } = entryOf(created.output)
    const publishAt = new Date(Date.now() + 1500).toISOString()
    const warnings = [{ contract: 'translation-pair', path: '/frontmatter/translationGroup' }]
    const hollware = server.getWorker()
    const status = async () =>
      entryOf(
        (await agent.call('get_entry', { collection: 'blog', locale: 'en', slug: 'later' })).output,
      ).status

    const scheduled = await agent.call('publish', {
      id,
      version,
      publishAt,
      acknowledgeWarnings: warnings,
    })
    await hollware.scheduled({ cron: '* * * * *', scheduledTime: new Date() })
    const early = await status()
    await new Promise((resolve) => setTimeout(resolve, 1600))
    await hollware.scheduled({ cron: '* * * * *', scheduledTime: new Date() })
    const late = await eventually(status, (value) => value === 'published')

    expect([scheduled.output['outcome'], early, late]).toEqual([
      'scheduled',
      'scheduled',
      'published',
    ])
  })
})
