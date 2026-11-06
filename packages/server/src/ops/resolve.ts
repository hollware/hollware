import {
  compileRoutes,
  matchRoute,
  type ResolvedPath,
  type resolvePathInput,
  type ResolvedSite,
} from '@hollware/core'
import type * as z from 'zod'
import { entryPath } from './event.ts'
import type { OperationContext } from './types.ts'

function routesOf(site: ResolvedSite) {
  return compileRoutes(
    Object.fromEntries(
      [...site.collections].map(([name, collection]) => [name, collection.routes]),
    ),
    Object.fromEntries(
      [...site.collections].flatMap(([name, collection]) =>
        collection.nesting === null ? [] : [[name, collection.nesting.maxDepth]],
      ),
    ),
  )
}

function pathnameOf(path: string): string {
  const end = path.search(/[?#]/)
  return end === -1 ? path : path.slice(0, end)
}

export async function resolvePath(
  input: z.output<typeof resolvePathInput>,
  context: OperationContext,
): Promise<ResolvedPath> {
  const matched = matchRoute(pathnameOf(input.path), routesOf(context.site))
  if (matched === undefined) return { outcome: 'not_found' }
  const collection = context.site.collections.get(matched.collection)
  if (collection === undefined) return { outcome: 'not_found' }
  const ref = { collection: matched.collection, locale: matched.locale, slug: matched.slug }
  const found = await context.store.findEntry(context.site.key, ref, context.view)
  const movedTo = found === null ? await context.store.redirectOf(context.site.key, ref) : null
  const target =
    found ??
    (movedTo === null
      ? null
      : await context.store.findEntryById(context.site.key, movedTo, context.view))
  if (target === null) return { outcome: 'not_found' }
  const { entry } = target
  const path = entryPath(collection, entry.locale, entry.slugPath)
  if (path === null) return { outcome: 'not_found' }
  return {
    outcome: found !== null && entry.slugPath === matched.slugPath ? 'ok' : 'redirect',
    collection: entry.collection,
    locale: entry.locale,
    slug: entry.slug,
    path,
  }
}
