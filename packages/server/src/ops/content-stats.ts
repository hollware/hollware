import type { EntryRef, ResolvedSite } from '@hollware/core'
import { entrySummary } from './answers.ts'
import type { OperationHandler } from './types.ts'

/** A path without its trailing slash, so that `/blog/a` and `/blog/a/` are one page. */
function trimmed(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/**
 * The entry that a path of the site shows, by the routes of its collections: the slug is the part
 * of the path where the route has `:slug`. `null` for a path that no route has.
 */
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

/**
 * The most read pages of the site, from the counts of its beacons (ADR-031), each with the
 * published entry it shows. `unavailable` when the deployment cannot read the counts.
 */
export const contentStats: OperationHandler<'content_stats'> = async (input, context) => {
  const analytics = context.analytics ?? null
  if (analytics === null) return { outcome: 'unavailable' }
  const site = context.site
  const counts = await analytics.topPages(site.key, { days: input.days, limit: input.limit })
  const pages = await Promise.all(
    counts.map(async (count) => {
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
  return { outcome: 'ok', since, pages }
}
