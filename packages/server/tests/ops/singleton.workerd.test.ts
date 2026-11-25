import {
  contracts,
  defineCollection,
  defineConfig,
  resolveConfig,
  type ResolvedSite,
} from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { createD1Store } from '../../src/db/index.ts'
import { resolvePath } from '../../src/ops/resolve.ts'
import { fixedClock } from '../db/support.ts'
import { agent, BINDING, contextFor, newTenant, warmUpComark } from './support.ts'
import { START } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const page = z.looseObject({ title: z.string().min(1) })

function singletonSite(key: string): ResolvedSite {
  const site = resolveConfig(
    defineConfig({
      sites: {
        [key]: {
          locales: ['es', 'en'],
          defaultLocale: 'es',
          collections: {
            home: defineCollection({
              singleton: true,
              schema: page,
              routes: { es: '/', en: '/en/' },
            }),
            settings: defineCollection({ singleton: true, schema: page }),
            pages: defineCollection({
              schema: page,
              routes: { es: '/:slug/', en: '/en/:slug/' },
              contracts: [contracts.internalLinksResolve()],
            }),
          },
        },
      },
    }),
  ).sites.get(key)
  if (site === undefined) throw new Error(`resolveConfig lost the site ${key}`)
  return site
}

async function newSingletons(label: string) {
  const owner = await newTenant(env.DB, label)
  const tenant = { ...owner, site: singletonSite(owner.key) }
  const time = fixedClock(START)
  const store = createD1Store(env.DB, { clock: time.clock })
  const writer = agent(contextFor(tenant, store, { clock: time.clock }))
  const reader = contextFor(tenant, store, {
    clock: time.clock,
    view: 'published',
    principal: BINDING,
  })
  const create = async (collection: string, locale: string, slug: string, body = 'Texto.') => {
    const created = await writer.createDraft({
      collection,
      locale,
      slug,
      markdown: `---\ntitle: ${slug}\n---\n\n${body}\n`,
    })
    if (created.outcome !== 'saved' || created.entry === undefined) {
      throw new Error(`${slug} was not saved: ${JSON.stringify(created)}`)
    }
    return created.entry
  }
  return { writer, reader, create }
}

describe('a singleton collection', () => {
  it('holds one entry per locale: a second one in a locale is refused, a translation is not', async () => {
    const world = await newSingletons('singleton-one')
    await world.create('home', 'es', 'inicio')

    const second = world.writer.createDraft({
      collection: 'home',
      locale: 'es',
      slug: 'otra',
      markdown: '---\ntitle: Otra\n---\n\nTexto.\n',
    })
    await expect(second).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'The collection "home" is a singleton and already holds its entry in es: "inicio".',
      fix: 'Change that entry with update_draft (read it with get_entry, slug "inicio"), or create the entry in another locale of the site.',
    })
    expect((await world.create('home', 'en', 'home')).slug).toBe('home')
  })

  it('lets a collection that is no singleton hold many entries of a locale', async () => {
    const world = await newSingletons('singleton-many')
    await world.create('pages', 'es', 'precios')

    expect((await world.create('pages', 'es', 'equipo')).slug).toBe('equipo')
  })

  it('is found at its fixed path once published, whatever its slug', async () => {
    const world = await newSingletons('singleton-path')
    const home = await world.create('home', 'es', 'inicio')
    const before = await resolvePath({ path: '/' }, world.reader)
    await world.writer.publish({ id: home.id, version: home.version })

    const root = await resolvePath({ path: '/' }, world.reader)
    const english = await resolvePath({ path: '/en/' }, world.reader)

    expect(before).toEqual({ outcome: 'not_found' })
    expect(root).toEqual({
      outcome: 'ok',
      collection: 'home',
      locale: 'es',
      slug: 'inicio',
      path: '/',
    })
    expect(english).toEqual({ outcome: 'not_found' })
  })

  it('reads with its path: the fixed one, the route with the slug, or null without a route', async () => {
    const world = await newSingletons('singleton-read')
    await world.create('home', 'en', 'home')
    await world.create('settings', 'es', 'ajustes')
    await world.create('pages', 'en', 'pricing')

    const read = (collection: string, locale: string, slug: string) =>
      world.writer.getEntry({ collection, locale, slug })
    const listed = await world.writer.listEntries({ collection: 'pages' })

    expect((await read('home', 'en', 'home')).entry?.path).toBe('/en/')
    expect((await read('settings', 'es', 'ajustes')).entry?.path).toBeNull()
    expect((await read('pages', 'en', 'pricing')).entry?.path).toBe('/en/pricing/')
    expect(listed.entries.map((entry) => entry.path)).toEqual(['/en/pricing/'])
  })

  it('takes a link to its fixed path as a link to its entry, which must be published', async () => {
    const world = await newSingletons('singleton-link')
    const home = await world.create('home', 'es', 'inicio')
    const pricing = await world.create('pages', 'es', 'precios', '[Inicio](/)')

    const blocked = await world.writer.publish({ id: pricing.id, version: pricing.version })
    await world.writer.publish({ id: home.id, version: home.version })
    const published = await world.writer.publish({ id: pricing.id, version: pricing.version })

    expect(blocked.outcome).toBe('blocked')
    expect(blocked.verdict?.errors.map((error) => error.code)).toEqual([
      'internal-links-resolve.unpublished',
    ])
    expect(published.outcome).toBe('published')
  })
})
