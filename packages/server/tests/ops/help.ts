import { defineCollection, defineConfig, resolveConfig, type ResolvedSite } from '@hollware/core'
import { env } from 'cloudflare:workers'
import * as z from 'zod'

import { createD1Store } from '../../src/db/index.ts'
import type { ContentStore } from '../../src/ports.ts'
import { fixedClock } from '../db/support.ts'
import { agent, BINDING, contextFor, newTenant, type ContextOptions } from './support.ts'
import { START } from './world.ts'

const help = defineCollection({
  schema: z.looseObject({ title: z.string().min(1) }),
  routes: { es: '/ayuda/:slug/', en: '/en/help/:slug/' },
  nesting: { maxDepth: 3 },
})

const flat = defineCollection({
  schema: z.looseObject({ title: z.string().min(1) }),
  routes: { es: '/notas/:slug/', en: '/en/notes/:slug/' },
})

export function helpSite(key: string): ResolvedSite {
  const site = resolveConfig(
    defineConfig({
      sites: {
        [key]: { locales: ['es', 'en'], defaultLocale: 'es', collections: { help, notes: flat } },
      },
    }),
  ).sites.get(key)
  if (site === undefined) throw new Error(`resolveConfig lost the site ${key}`)
  return site
}

export async function newHelp(
  label: string,
  wrap: (store: ContentStore) => ContentStore = (one) => one,
) {
  const owner = await newTenant(env.DB, label)
  const tenant = { ...owner, site: helpSite(owner.key) }
  const time = fixedClock(START)
  const plain = createD1Store(env.DB, { clock: time.clock })
  const store = wrap(plain)
  const context = (options: Partial<ContextOptions> = {}, over: ContentStore = store) =>
    contextFor(tenant, over, { clock: time.clock, ...options })
  const writer = agent(context())
  const page = async (slug: string, parent?: string, collection = 'help') => {
    const created = await writer.createDraft({
      collection,
      locale: 'es',
      slug,
      markdown: `---\ntitle: Página ${slug}\n---\n\nTexto de ${slug}.\n`,
      ...(parent === undefined ? {} : { parent }),
    })
    if (created.outcome !== 'saved' || created.entry === undefined) {
      throw new Error(`${slug} was not saved: ${JSON.stringify(created)}`)
    }
    return created.entry
  }
  const current = async (slug: string) => {
    const found = await writer.getEntry({ collection: 'help', locale: 'es', slug })
    if (found.entry === undefined) throw new Error(`${slug} is gone`)
    return found.entry
  }
  const publishAll = async (...slugs: string[]) => {
    for (const slug of slugs) {
      const entry = await current(slug)
      const published = await writer.publish({ id: entry.id, version: entry.version })
      if (published.outcome !== 'published') {
        throw new Error(`${slug} was not published: ${JSON.stringify(published)}`)
      }
    }
  }
  return {
    tenant,
    time,
    plain,
    context,
    writer,
    reader: context({ view: 'published', principal: BINDING }),
    page,
    current,
    publishAll,
  }
}

export async function rowsOf(site: string) {
  const { results } = await env.DB.prepare(
    `SELECT e.slug, e.slug_path, e.position, p.slug AS parent, p.slug_path AS parent_path
       FROM entries AS e LEFT JOIN entries AS p ON p.id = e.parent_id
      WHERE e.site_id = ?1 ORDER BY e.slug_path`,
  )
    .bind(site)
    .all<{
      slug: string
      slug_path: string
      position: number | null
      parent: string | null
      parent_path: string | null
    }>()
  return results
}
