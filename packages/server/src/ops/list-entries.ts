import { entrySummary } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
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
  return { outcome: 'ok', entries: page.entries.map(entrySummary), nextCursor: page.nextCursor }
}
