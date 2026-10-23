import type { EntryRef, ResolvedSite } from '@hollware/core'
import { entrySummary } from './answers.ts'
import type { OperationHandler } from './types.ts'

function trimmed(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function entryRefOf(site: ResolvedSite, path: string): EntryRef | null {
  const wanted = trimmed(path)
  for (const [collection, resolved] of site.collections) {
    for (const [locale, route] of Object.entries(resolved.routes)) {
      const [before, after, ...rest] = trimmed(route).split(':slug')
      if (before === undefined || after === undefined || rest.length > 0) continue
      if (!wanted.startsWith(before) || !wanted.endsWith(after)) continue
      const slug = wanted.slice(before.length, wanted.length - after.length)
      if (slug !== '' && !slug.includes('/')) return { collection, locale, slug }
    }
  }
  return null
}

export const contentStats: OperationHandler<'content_stats'> = async (input, context) => {
  const sources = context.analytics ?? null
  if (sources === null) {
    return {
      outcome: 'unavailable',
      fix: 'Ask over MCP: the analytics of a site are read there, not over RPC.',
    }
  }
  const site = context.site
  const counts = await sources.topPages(site, { days: input.days, limit: input.limit })
  if (counts.outcome === 'unavailable') return { outcome: 'unavailable', fix: counts.fix }
  const pages = await Promise.all(
    counts.pages.map(async (count) => {
      const ref = entryRefOf(site, count.path)
      const found = ref === null ? null : await context.store.findEntry(site.key, ref, 'published')
      return {
        path: count.path,
        views: count.views,
        entry: found === null ? null : entrySummary(found),
      }
    }),
  )
  const since = new Date(context.clock.now().getTime() - input.days * 86_400_000).toISOString()
  return { outcome: 'ok', since, source: counts.provider, pages }
}
