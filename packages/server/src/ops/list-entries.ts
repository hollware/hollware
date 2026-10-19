import { summaryFor } from './automatic.ts'
import { forReaders, imagesNamed, readsUrls, summaryImages } from './assets.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { translationOutdated } from './translations.ts'
import type { OperationHandler } from './types.ts'

/** Lists a page of the entries of a collection, in the view of the call. */
export const listEntries: OperationHandler<'list_entries'> = async (input, context) => {
  requireCollection(context.site, input.collection)
  if (input.locale !== undefined) requireLocale(context.site, input.locale)
  // A cursor that no listing of this view returned is the store's `invalid_input`: let it through.
  const page = await context.store.listEntries(context.site.key, {
    collection: input.collection,
    locale: input.locale,
    tag: input.tag,
    status: input.status,
    trashed: input.trashed,
    view: context.view,
    limit: input.limit,
    cursor: input.cursor,
  })
  const outdated = await translationOutdated(context, page.entries)
  const summaries = page.entries.map((view) => summaryFor(context, view))
  // A site lays out the covers of a listing: the images the frontmatters name, in one read.
  const images = readsUrls(context)
    ? await imagesNamed(
        context,
        summaries.map((summary) => summary.frontmatter),
      )
    : new Map()
  return {
    outcome: 'ok',
    entries: summaries.map((summary) => {
      const stale = outdated.get(summary.id)
      return {
        ...forReaders(context, {
          ...summary,
          ...(stale === undefined ? {} : { translationOutdated: stale }),
        }),
        ...summaryImages(context, summary.frontmatter, images),
      }
    }),
    nextCursor: page.nextCursor,
  }
}
