import {
  compileRoutes,
  matchRoute,
  type ResolvedPath,
  type resolvePathInput,
  type ResolvedSite,
} from '@hollware/core'
import type * as z from 'zod'
import { entryPath } from './event.ts'
import type { EntryView } from '../ports.ts'
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

async function singletonOf(context: OperationContext, collection: string, locale: string) {
  const page = await context.store.listEntries(context.site.key, {
    collection,
    locale,
    view: context.view,
    limit: 1,
  })
  return page.entries[0]
}

function pathnameOf(path: string): string {
  const end = path.search(/[?#]/)
  return end === -1 ? path : path.slice(0, end)
}

export async function resolvePath(
  input: z.output<typeof resolvePathInput>,
  context: OperationContext,
  preview: string | null = null,
): Promise<ResolvedPath> {
  const matched = matchRoute(pathnameOf(input.path), routesOf(context.site))
  if (matched === undefined) return { outcome: 'not_found' }
  const collection = context.site.collections.get(matched.collection)
  if (collection === undefined) return { outcome: 'not_found' }
  const visible = <V extends Pick<EntryView, 'entry'>>(view: V | null | undefined) =>
    view !== null &&
    view !== undefined &&
    (view.entry.status === 'published' || view.entry.id === preview)
      ? view
      : null
  if (matched.slug === '') {
    const single = visible(await singletonOf(context, matched.collection, matched.locale))
    return single === null
      ? { outcome: 'not_found' }
      : {
          outcome: 'ok',
          collection: single.entry.collection,
          locale: single.entry.locale,
          slug: single.entry.slug,
          path: entryPath(collection, single.entry.locale, single.entry.slugPath) ?? input.path,
        }
  }
  const ref = { collection: matched.collection, locale: matched.locale, slug: matched.slug }
  const live = visible(await context.store.findEntry(context.site.key, ref, context.view))
  const here = live !== null && live.entry.slugPath === matched.slugPath
  const moved = here
    ? null
    : await context.store.redirectOf(context.site.key, { ...ref, slugPath: matched.slugPath })
  const target =
    here || (moved !== null && !moved.exact && live !== null)
      ? live
      : moved === null
        ? live
        : visible(await context.store.findEntryById(context.site.key, moved.entryId, context.view))
  if (target === null) return { outcome: 'not_found' }
  const { entry } = target
  const path = entryPath(collection, entry.locale, entry.slugPath)
  if (path === null) return { outcome: 'not_found' }
  return {
    outcome: here && entry.id === live?.entry.id ? 'ok' : 'redirect',
    collection: entry.collection,
    locale: entry.locale,
    slug: entry.slug,
    path,
  }
}
