import { HollwareError } from '@hollware/core'
import { entrySummary } from './answers.ts'
import { forReaders } from './assets.ts'
import { requireCollection } from './collections.ts'
import { translationOutdated } from './translations.ts'
import type { OperationHandler } from './types.ts'

/** Reads the entries of a translation group in the view of the call, one per locale. */
export const getTranslations: OperationHandler<'get_translations'> = async (input, context) => {
  const collection = requireCollection(context.site, input.collection)
  if (collection.translationGroupField === null) {
    throw new HollwareError(
      'invalid_input',
      `The collection ${JSON.stringify(collection.name)} has no translations, so its entries belong to no translation group.`,
      'describe_site shows translationGroupField as null for this collection: read its entries with get_entry or list_entries instead.',
    )
  }
  const group = await context.store.listTranslations(
    context.site.key,
    input.collection,
    input.translationGroup,
    context.view,
  )
  if (group.length === 0) return { outcome: 'not_found' }
  const outdated = await translationOutdated(context, group)
  return {
    outcome: 'ok',
    entries: group.map((entry) => {
      const stale = outdated.get(entry.entry.id)
      return forReaders(context, {
        ...entrySummary(entry),
        ...(stale === undefined ? {} : { translationOutdated: stale }),
      })
    }),
  }
}
