import {
  defineCollection,
  defineConfig,
  HollwareError,
  newId,
  resolveConfig,
  type ResolvedSite,
} from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod'

import { createD1Store } from '../../src/db/index.ts'
import { getNavigation } from '../../src/ops/navigation.ts'
import { seedToken } from '../auth/support.ts'
import { boot, failure, NOW, testClock } from '../http/support.ts'

const KEY = 'navigation-tests'

const pages = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  section: z.enum(['start', 'guides', 'reference']).optional(),
  order: z.number().int().optional(),
})

const CONFIG = defineConfig({
  sites: {
    [KEY]: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      collections: {
        docs: defineCollection({
          schema: pages,
          routes: { en: '/docs/:slug/', es: '/es/docs/:slug/' },
          navigation: { groupBy: 'section', orderBy: 'order' },
        }),
        manual: defineCollection({
          schema: pages,
          routes: { en: '/manual/:slug/', es: '/es/manual/:slug/' },
          navigation: { groupBy: 'section', groups: ['reference', 'start'], orderBy: 'order' },
        }),
        notes: defineCollection({
          schema: pages,
          routes: { en: '/notes/:slug/', es: '/es/notes/:slug/' },
        }),
      },
    },
  },
})

const SITE: ResolvedSite = (() => {
  const site = resolveConfig(CONFIG).sites.get(KEY)
  if (site === undefined) throw new Error('the test config has no site')
  return site
})()

interface Seed {
  readonly collection: string
  readonly locale?: string
  readonly slug: string
  readonly frontmatter: Record<string, unknown>
  readonly draft?: boolean
}

const SEEDS: readonly Seed[] = [
  {
    collection: 'docs',
    slug: 'install',
    frontmatter: { title: 'Install', section: 'start', order: 2 },
  },
  {
    collection: 'docs',
    slug: 'welcome',
    frontmatter: { title: 'Welcome', description: 'Start here.', section: 'start', order: 1 },
  },
  { collection: 'docs', slug: 'caching', frontmatter: { title: 'Caching', section: 'guides' } },
  {
    collection: 'docs',
    slug: 'deploy',
    frontmatter: { title: 'Deploy', section: 'guides', order: 1 },
  },
  {
    collection: 'docs',
    slug: 'api-b',
    frontmatter: { title: 'API', section: 'reference', order: 1 },
  },
  {
    collection: 'docs',
    slug: 'api-a',
    frontmatter: { title: 'API', section: 'reference', order: 1 },
  },
  {
    collection: 'docs',
    slug: 'alpha',
    frontmatter: { title: 'Alpha', section: 'reference', order: 1 },
  },
  { collection: 'docs', slug: 'orphan', frontmatter: { title: 'Orphan' } },
  {
    collection: 'docs',
    slug: 'unreleased',
    frontmatter: { title: 'Unreleased', section: 'start', order: 0 },
    draft: true,
  },
  {
    collection: 'docs',
    locale: 'es',
    slug: 'instalar',
    frontmatter: { title: 'Instalar', section: 'start', order: 2 },
  },
  {
    collection: 'manual',
    slug: 'setup',
    frontmatter: { title: 'Setup', section: 'start', order: 1 },
  },
  {
    collection: 'manual',
    slug: 'tips',
    frontmatter: { title: 'Tips', section: 'guides', order: 1 },
  },
  {
    collection: 'manual',
    slug: 'cli',
    frontmatter: { title: 'CLI', section: 'reference', order: 5 },
  },
  { collection: 'notes', slug: 'zeta', frontmatter: { title: 'Zeta', section: 'start', order: 1 } },
  {
    collection: 'notes',
    slug: 'beta',
    frontmatter: { title: 'Beta', section: 'guides', order: 9 },
  },
]

async function seed(seeds: readonly Seed[]): Promise<void> {
  const author = newId('usr')
  const statements = seeds.flatMap((one, index) => {
    const entry = newId('ent')
    const revision = newId('rev')
    const published = one.draft !== true
    const at = new Date(Date.parse(NOW) + index * 1000).toISOString()
    return [
      env.DB.prepare(
        `INSERT INTO entries (id, site_id, collection, locale, slug, status, version, head_rev,
          published_rev, published_at, published_sort_key, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?8, ?9, ?9, ?10, ?10)`,
      ).bind(
        entry,
        KEY,
        one.collection,
        one.locale ?? 'en',
        one.slug,
        published ? 'published' : 'draft',
        revision,
        published ? revision : null,
        published ? at : null,
        at,
      ),
      env.DB.prepare(
        `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document,
          comark_version, pipeline_version, word_count, verdict, actor_kind, actor_user_id,
          created_at, updated_at)
          VALUES (?1, ?2, ?3, '', ?4, '{"nodes":[],"frontmatter":{},"meta":{}}', 'seed', 'seed',
            0, '{"ok":true}', 'user', ?5, ?6, ?6)`,
      ).bind(revision, KEY, entry, JSON.stringify(one.frontmatter), author, at),
    ]
  })
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Owner', 'owner', ?2, ?2)",
    ).bind(author, NOW),
    ...statements,
  ])
}

const worker = boot({ config: CONFIG })

beforeAll(async () => {
  await worker.ready()
  await seed(SEEDS)
})

function link(
  slug: string,
  title: string,
  order: number | null,
  path: string,
  description: string | null = null,
) {
  return { slug, title, description, path, order }
}

const DOCS_EN = {
  outcome: 'ok',
  collection: 'docs',
  locale: 'en',
  groups: [
    {
      name: 'start',
      entries: [
        link('welcome', 'Welcome', 1, '/docs/welcome/', 'Start here.'),
        link('install', 'Install', 2, '/docs/install/'),
      ],
    },
    {
      name: 'guides',
      entries: [
        link('deploy', 'Deploy', 1, '/docs/deploy/'),
        link('caching', 'Caching', null, '/docs/caching/'),
      ],
    },
    {
      name: 'reference',
      entries: [
        link('alpha', 'Alpha', 1, '/docs/alpha/'),
        link('api-a', 'API', 1, '/docs/api-a/'),
        link('api-b', 'API', 1, '/docs/api-b/'),
      ],
    },
    { name: null, entries: [link('orphan', 'Orphan', null, '/docs/orphan/')] },
  ],
}

describe('getNavigation over RPC', () => {
  const rpc = () => new worker.worker.Hollware(worker.ctx, worker.env)

  it('groups the published entries in the order of the enum, each by order then title then slug, those with no section last', async () => {
    expect(await rpc().getNavigation(KEY, 'docs')).toEqual(DOCS_EN)
  })

  it('reads the locale it is given, with the route of that locale', async () => {
    expect(await rpc().getNavigation(KEY, 'docs', { locale: 'es' })).toEqual({
      outcome: 'ok',
      collection: 'docs',
      locale: 'es',
      groups: [{ name: 'start', entries: [link('instalar', 'Instalar', 2, '/es/docs/instalar/')] }],
    })
  })

  it('puts the groups given first, then the rest of the enum', async () => {
    const navigation = await rpc().getNavigation(KEY, 'manual')

    expect(
      navigation.groups.map((group) => [group.name, group.entries.map((entry) => entry.slug)]),
    ).toEqual([
      ['reference', ['cli']],
      ['start', ['setup']],
      ['guides', ['tips']],
    ])
  })

  it('lists a collection without a navigation in one group, by title', async () => {
    expect(await rpc().getNavigation(KEY, 'notes')).toEqual({
      outcome: 'ok',
      collection: 'notes',
      locale: 'en',
      groups: [
        {
          name: null,
          entries: [
            link('beta', 'Beta', null, '/notes/beta/'),
            link('zeta', 'Zeta', null, '/notes/zeta/'),
          ],
        },
      ],
    })
  })

  it('refuses a collection the site does not have, and an option it does not know', async () => {
    const unknown = await failure(rpc().getNavigation(KEY, 'blog'))
    const option = await failure(rpc().getNavigation(KEY, 'docs', JSON.parse('{"tag":"x"}')))

    expect(unknown).toMatchObject({ code: 'unknown_collection' })
    expect(option).toMatchObject({
      code: 'invalid_input',
      message: 'The call has options that Hollware does not know: tag.',
    })
  })
})

describe('GET /v1/:collection/navigation', () => {
  it('answers the navigation to a read token, in the locale of the query', async () => {
    const { token } = await seedToken(env.DB, KEY, { read: true })

    const english = await worker.send('/v1/docs/navigation', { token })
    const spanish = await worker.send('/v1/docs/navigation?locale=es', { token })

    expect([english.status, await english.json()]).toEqual([200, DOCS_EN])
    expect(spanish.status).toBe(200)
    expect(await spanish.json()).toMatchObject({ locale: 'es', groups: [{ name: 'start' }] })
  })

  it('answers 404 for a locale the site does not have', async () => {
    const { token } = await seedToken(env.DB, KEY, { read: true })

    const response = await worker.send('/v1/docs/navigation?locale=fr', { token })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 'unknown_locale' })
  })

  it('answers 401 without a token', async () => {
    expect((await worker.send('/v1/docs/navigation')).status).toBe(401)
  })
})

describe('a navigation of more entries than it arranges', () => {
  it('is refused with a fix, once a page holds more than the cap', async () => {
    const context = {
      site: SITE,
      principal: { kind: 'binding', scopes: ['content:read'] },
      view: 'published',
      store: createD1Store(env.DB),
      clock: testClock(),
      client: null,
      requestId: 'req_navigation',
      reader: true,
    } as const

    const refused = await failure(getNavigation({ collection: 'docs' }, context, 7))
    const arranged = await getNavigation({ collection: 'docs' }, context, 8)

    expect(refused).toBeInstanceOf(HollwareError)
    expect(refused).toMatchObject({
      code: 'output_too_large',
      message:
        'The collection "docs" has more than 7 published entries in en, more than a navigation arranges.',
      fix: 'Read the collection a page at a time with listEntries, and build the navigation from those pages.',
    })
    expect(arranged.groups.flatMap((group) => group.entries)).toHaveLength(8)
  })
})
