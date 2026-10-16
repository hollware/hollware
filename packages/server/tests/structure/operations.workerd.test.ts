import {
  collectionDefinitionData,
  siteDefinitionData,
  type SiteDefinitionInput,
} from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createD1Store } from '../../src/db/index.ts'
import { handlers } from '../../src/ops/index.ts'
import type { OperationContext } from '../../src/ops/types.ts'
import { createSiteRegistry } from '../../src/structure/registry.ts'
import { createStructureStore } from '../../src/structure/store.ts'
import { seedSite } from '../support/sites.ts'
import { seal, unseal } from '../../src/structure/seal.ts'
import { createSecretStore } from '../../src/structure/store.ts'

// Fails when: an operation on the structure (src/ops/structure.ts, src/structure/store.ts) stops
// answering with the definition and its version; stops refusing a definition that does not
// compile, with its problems, or one sent at a stale version, writing nothing; stops asking to
// confirm a change that strands entries (a removed collection or locale) or that a new schema
// refuses, with the counts and slugs; stops writing a confirmed change with its line of
// site_changes, and making the Worker serve it at once; or stops creating a site with its maker
// as owner, refusing a key that exists, and trashing and restoring only a site the caller owns.

const NOW = new Date('2026-10-16T12:00:00.000Z')
const MASTER = 'k'.repeat(40)

const BLOG: SiteDefinitionInput = {
  locales: ['en', 'es'],
  defaultLocale: 'en',
  collections: {
    blog: {
      schema: { type: 'object', properties: { title: { type: 'string' } } },
      routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
    },
  },
}

async function setUp() {
  const key = `shape-${crypto.randomUUID().slice(0, 8)}`
  const seeded = await seedSite(env.DB, key)
  await env.DB.prepare('UPDATE sites SET definition = ?1, version = 1 WHERE id = ?2')
    .bind(JSON.stringify(siteDefinitionData.parse(BLOG)), key)
    .run()
  const registry = createSiteRegistry({ now: () => NOW, log: () => undefined })
  await registry.refresh(env.DB)
  const contextOf = (userId: string): OperationContext => {
    const site = registry.sites.get(key)
    if (site === undefined) throw new Error(`no site ${key}`)
    return {
      site,
      principal: {
        kind: 'token',
        userId,
        tokenId: seeded.tokenId,
        site: key,
        scopes: ['schema:admin'],
      },
      view: 'head',
      store: createD1Store(env.DB, { clock: { now: () => NOW } }),
      clock: { now: () => NOW },
      client: { name: 'test-agent' },
      requestId: 'req',
      structure: {
        store: createStructureStore(env.DB, () => NOW),
        changed: () => registry.refresh(env.DB, { force: true }),
        secrets: {
          make: async (site, name) => {
            await createSecretStore(env.DB, () => NOW).write(
              site,
              name,
              await seal(MASTER, 'whsec_made'),
            )
            return 'whsec_made'
          },
        },
      },
    }
  }
  return { key, seeded, registry, context: contextOf(seeded.userId), contextOf }
}

async function changesOf(site: string) {
  const { results } = await env.DB.prepare(
    'SELECT version, actor_user_id, actor_meta, before IS NOT NULL AS had, after IS NOT NULL AS has FROM site_changes WHERE site_id = ?1 ORDER BY version',
  )
    .bind(site)
    .all()
  return results
}

describe('get_structure', () => {
  it('answers the definition with its defaults, its version and the catalog', async () => {
    const { key, context } = await setUp()

    const answer = await handlers.get_structure({}, context)

    expect([answer.site, answer.version]).toEqual([key, 1])
    expect(answer.definition.collections['blog']?.rules).toEqual([])
    expect(answer.catalog.map((rule) => rule.name)).toContain('field-length')
  })
})

describe('update_site', () => {
  it('refuses a definition that does not compile, and one at a stale version, writing nothing', async () => {
    const { key, context } = await setUp()

    const invalid = await handlers.update_site(
      {
        version: 1,
        definition: siteDefinitionData.parse({ ...BLOG, defaultLocale: 'fr' }),
        confirm: false,
      },
      context,
    )
    // A stale version is a conflict before anything is weighed: this one would strand entries.
    const stale = await handlers.update_site(
      {
        version: 0,
        definition: siteDefinitionData.parse({
          locales: ['en'],
          defaultLocale: 'en',
          collections: { blog: { schema: { type: 'object' }, routes: { en: '/blog/:slug/' } } },
        }),
        confirm: false,
      },
      context,
    )

    expect(invalid.outcome).toBe('invalid')
    expect(invalid.problems?.map((problem) => problem.path)).toEqual([`sites.${key}.defaultLocale`])
    expect(stale).toEqual({ outcome: 'conflict', currentVersion: 1 })
    expect(await changesOf(key)).toEqual([])
  })

  it('asks to confirm a removed collection and locale that hold entries, then writes it', async () => {
    const { key, context, registry } = await setUp()
    const next = siteDefinitionData.parse({
      locales: ['en'],
      defaultLocale: 'en',
      collections: { notes: { schema: { type: 'object' }, routes: { en: '/notes/:slug/' } } },
    })

    const asked = await handlers.update_site(
      { version: 1, definition: next, confirm: false },
      context,
    )
    const done = await handlers.update_site(
      { version: 1, definition: next, confirm: true },
      context,
    )

    expect(asked).toEqual({
      outcome: 'needs_confirmation',
      impact: {
        removedCollections: [{ name: 'blog', entries: 3 }],
        removedLocales: [{ locale: 'es', entries: 1 }],
        refused: [],
      },
    })
    expect(done).toEqual({ outcome: 'updated', version: 2 })
    expect([...(registry.sites.get(key)?.collections.keys() ?? [])]).toEqual(['notes'])
    expect(await changesOf(key)).toEqual([
      {
        version: 2,
        actor_user_id: context.principal.kind === 'token' ? context.principal.userId : '',
        actor_meta: '{"name":"test-agent"}',
        had: 1,
        has: 1,
      },
    ])
  })

  it('answers unchanged for the definition it has', async () => {
    const { context } = await setUp()
    const same = siteDefinitionData.parse(BLOG)

    expect(
      await handlers.update_site({ version: 1, definition: same, confirm: false }, context),
    ).toEqual({
      outcome: 'unchanged',
      version: 1,
    })
  })
})

describe('set_collection', () => {
  it('asks to confirm a schema that refuses entries, with their slugs, then writes it', async () => {
    const { key, context, registry } = await setUp()
    const strict = {
      ...siteDefinitionData.parse(BLOG).collections['blog'],
      schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    }
    const collection = collectionDefinitionData.parse(strict)

    const asked = await handlers.set_collection(
      { version: 1, name: 'blog', collection, confirm: false },
      context,
    )
    const done = await handlers.set_collection(
      { version: 1, name: 'blog', collection, confirm: true },
      context,
    )

    expect(asked).toEqual({
      outcome: 'needs_confirmation',
      impact: {
        removedCollections: [],
        removedLocales: [],
        refused: [
          {
            collection: 'blog',
            entries: 3,
            examples: ['cache-en-el-borde', 'edge-caching-basics', 'from-draft-to-published'],
          },
        ],
      },
    })
    expect(done).toEqual({ outcome: 'updated', version: 2 })
    const schema = registry.sites.get(key)?.collections.get('blog')?.schema
    expect((await schema?.['~standard'].validate({}))?.issues?.map((issue) => issue.path)).toEqual([
      ['title'],
    ])
  })
})

describe('create_site, delete_site and restore_site', () => {
  it('creates a site with its maker as owner, served at once, and refuses a key that exists', async () => {
    const { key, context, registry } = await setUp()
    const made = `${key}-new`

    const created = await handlers.create_site(
      { key: made, definition: siteDefinitionData.parse(BLOG) },
      context,
    )
    const again = await handlers.create_site(
      { key, definition: siteDefinitionData.parse(BLOG) },
      context,
    )

    expect([created.outcome, again.outcome]).toEqual(['created', 'taken'])
    expect(registry.keys.has(made)).toBe(true)
    expect(
      await env.DB.prepare('SELECT role FROM members WHERE site_id = ?1').bind(made).first('role'),
    ).toBe('owner')
  })

  it('trashes a site its owner confirms, and restores it; to anyone else it is not there', async () => {
    const { key, context, contextOf, registry } = await setUp()
    const stranger = contextOf((await seedSite(env.DB, `${key}-other`)).userId)

    expect(await handlers.delete_site({ key, confirm: false }, stranger)).toEqual({
      outcome: 'not_found',
    })
    expect(await handlers.delete_site({ key, confirm: false }, context)).toEqual({
      outcome: 'needs_confirmation',
      entries: 3,
    })
    expect(await handlers.delete_site({ key, confirm: true }, context)).toEqual({
      outcome: 'trashed',
    })
    expect(registry.keys.has(key)).toBe(false)

    expect(await handlers.restore_site({ key }, stranger)).toEqual({ outcome: 'not_found' })
    expect(await handlers.restore_site({ key }, context)).toEqual({ outcome: 'restored' })
    expect(registry.keys.has(key)).toBe(true)
  })
})

describe('make_webhook_secret', () => {
  it('makes a sealed secret for a webhook that names none, and for no other', async () => {
    const { key, context } = await setUp()
    const definition = siteDefinitionData.parse({
      ...BLOG,
      events: {
        webhooks: [
          { name: 'site', url: 'https://example.com/_hollware/webhook' },
          { name: 'legacy', url: 'https://example.com/in', secret: 'LEGACY_SECRET' },
        ],
      },
    })
    await handlers.update_site({ version: 1, definition, confirm: false }, context)

    const made = await handlers.make_webhook_secret({ webhook: 'site' }, context)
    const legacy = await handlers.make_webhook_secret({ webhook: 'legacy' }, context)
    const missing = await handlers.make_webhook_secret({ webhook: 'nope' }, context)

    expect([made, legacy, missing]).toEqual([
      { outcome: 'made', secret: 'whsec_made' },
      { outcome: 'not_found' },
      { outcome: 'not_found' },
    ])
    const sealed = await createSecretStore(env.DB, () => NOW).read(key, 'webhook:site')
    expect(await unseal(MASTER, sealed ?? '')).toBe('whsec_made')
  })
})
