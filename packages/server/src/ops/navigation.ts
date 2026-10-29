import {
  arrangeNavigation,
  HollwareError,
  NAVIGATION_MAX_ENTRIES,
  type Navigation,
  type NavigationSource,
  type navigationInput,
} from '@hollware/core'
import type * as z from 'zod'
import { summaryFor } from './automatic.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { entryPath } from './event.ts'
import type { OperationContext } from './types.ts'

const PAGE = 100

export async function getNavigation(
  input: z.output<typeof navigationInput>,
  context: OperationContext,
  maxEntries = NAVIGATION_MAX_ENTRIES,
): Promise<Navigation> {
  const collection = requireCollection(context.site, input.collection)
  const locale = input.locale ?? context.site.defaultLocale
  requireLocale(context.site, locale)
  const entries: NavigationSource[] = []
  let cursor: string | undefined
  do {
    const page = await context.store.listEntries(context.site.key, {
      collection: collection.name,
      locale,
      view: context.view,
      limit: PAGE,
      ...(cursor === undefined ? {} : { cursor }),
    })
    for (const view of page.entries) {
      entries.push({ slug: view.entry.slug, frontmatter: summaryFor(context, view).frontmatter })
    }
    if (entries.length > maxEntries) {
      throw new HollwareError(
        'output_too_large',
        `The collection "${collection.name}" has more than ${maxEntries} published entries in ${locale}, more than a navigation arranges.`,
        'Read the collection a page at a time with listEntries, and build the navigation from those pages.',
      )
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return arrangeNavigation({
    collection: collection.name,
    locale,
    navigation: collection.navigation,
    entries,
    pathOf: (slug) => entryPath(collection, locale, slug),
  })
}
