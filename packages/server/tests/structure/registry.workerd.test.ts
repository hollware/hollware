import type { SiteDefinitionInput } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createSiteRegistry } from '../../src/structure/registry.ts'

// Fails when: the registry of sites (src/structure/registry.ts) stops serving exactly the sites of
// D1 with a definition and not in the trash; stops compiling a site again when its version moves,
// and only then, and only once its poll is stale or forced; stops keeping the last good copy of a
// site whose new definition does not compile, and logging it; or stops moving a 0.x config into
// D1 once, as version 1 with a change of no actor, without touching a site that has a definition.

const BLOG: SiteDefinitionInput = {
  locales: ['en'],
  defaultLocale: 'en',
  collections: {
    posts: {
      schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      routes: { en: '/blog/:slug/' },
    },
  },
}

const withStyle = (styleGuide: string): SiteDefinitionInput => ({ ...BLOG, styleGuide })

function key(name: string): string {
  return `${name}-${crypto.randomUUID().slice(0, 8)}`
}

async function write(site: string, definition: unknown, version: number) {
  await env.DB.prepare(
    `INSERT INTO sites (id, definition, version, created_at, updated_at) VALUES (?1, ?2, ?3, 'now', 'now')
     ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, version = excluded.version`,
  )
    .bind(site, definition === null ? null : JSON.stringify(definition), version)
    .run()
}

function clock(start = 0) {
  let now = start
  return { now: () => new Date(now), advance: (ms: number) => (now += ms) }
}

describe('the registry of sites', () => {
  it('serves the sites of D1 with a definition, and leaves out one without or in the trash', async () => {
    const [served, bare, trashed] = [key('served'), key('bare'), key('trashed')]
    await write(served, BLOG, 1)
    await write(bare, null, 0)
    await write(trashed, BLOG, 2)
    await env.DB.prepare("UPDATE sites SET deleted_at = 'now' WHERE id = ?").bind(trashed).run()
    const registry = createSiteRegistry({ now: () => new Date(0), log: () => undefined })

    await registry.refresh(env.DB)

    expect(registry.sites.get(served)?.collections.get('posts')?.routes).toEqual({
      en: '/blog/:slug/',
    })
    expect([
      registry.keys.has(served),
      registry.keys.has(bare),
      registry.keys.has(trashed),
    ]).toEqual([true, false, false])
  })

  it('compiles a site again when its version moves, once its poll is stale', async () => {
    const site = key('moving')
    await write(site, withStyle('One.'), 1)
    const time = clock()
    const registry = createSiteRegistry({ now: time.now, log: () => undefined, pollMs: 1000 })
    await registry.refresh(env.DB)
    const first = registry.sites.get(site)

    await write(site, withStyle('Two.'), 2)
    await registry.refresh(env.DB)
    expect(registry.sites.get(site)).toBe(first)

    time.advance(1000)
    await registry.refresh(env.DB)
    expect(registry.sites.get(site)?.styleGuide).toBe('Two.')

    const second = registry.sites.get(site)
    time.advance(1000)
    await registry.refresh(env.DB)
    expect(registry.sites.get(site)).toBe(second)
  })

  it('keeps the last good copy of a site whose definition stops compiling, and logs it', async () => {
    const site = key('broken')
    await write(site, withStyle('Good.'), 1)
    const logs: object[] = []
    const registry = createSiteRegistry({
      now: () => new Date(0),
      log: (entry) => logs.push(entry),
    })
    await registry.refresh(env.DB)

    await write(site, { ...BLOG, defaultLocale: 'fr' }, 2)
    await registry.refresh(env.DB, { force: true })

    expect(registry.sites.get(site)?.styleGuide).toBe('Good.')
    expect(logs).toEqual([
      expect.objectContaining({ kind: 'site_definition_invalid', site, version: 2 }),
    ])
  })

  it('moves a 0.x config once, as version 1 with a change of no actor, over a bare row only', async () => {
    const [bare, defined] = [key('moved'), key('kept')]
    await write(bare, null, 0)
    await write(defined, withStyle('Mine.'), 4)
    const seed = { [bare]: withStyle('Config.'), [defined]: withStyle('Config.') }
    const registry = createSiteRegistry({ seed, now: () => new Date(0), log: () => undefined })

    await registry.refresh(env.DB)
    await registry.refresh(env.DB, { force: true })

    expect(registry.sites.get(bare)?.styleGuide).toBe('Config.')
    expect(registry.sites.get(defined)?.styleGuide).toBe('Mine.')
    const changes = await env.DB.prepare(
      'SELECT site_id, version, actor_user_id, before FROM site_changes WHERE site_id IN (?1, ?2)',
    )
      .bind(bare, defined)
      .all()
    expect(changes.results).toEqual([
      { site_id: bare, version: 1, actor_user_id: null, before: null },
    ])
  })
})
