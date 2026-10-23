import { refusalVerdict, verdictView } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { judge, processFor } from './draft.ts'
import type { OperationHandler } from './types.ts'

export const validate: OperationHandler<'validate'> = async (input, context) => {
  const collection = requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  const processed = await processFor(context.site, collection, input.markdown)
  if (!processed.ok) {
    return { outcome: 'ok', verdict: refusalVerdict('publish', processed.violations) }
  }
  const existing = await context.store.findEntry(
    context.site.key,
    { collection: input.collection, locale: input.locale, slug: input.slug },
    'head',
  )
  const verdict = await judge(
    context,
    collection,
    { locale: input.locale, slug: input.slug, entryId: existing?.entry.id ?? null },
    processed.value,
    'publish',
  )
  return { outcome: 'ok', verdict: verdictView(verdict) }
}
