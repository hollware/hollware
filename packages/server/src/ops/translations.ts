import type { EntrySummaryView } from '../ports.ts'
import type { OperationContext } from './types.ts'

export async function translationOutdated(
  context: OperationContext,
  views: readonly EntrySummaryView[],
): Promise<ReadonlyMap<string, boolean>> {
  const source = context.site.defaultLocale
  const translations = views.filter(
    (view) => view.entry.translationGroup !== null && view.entry.locale !== source,
  )
  if (translations.length === 0) return new Map()
  const site = context.site.key
  const [sources, own] = await Promise.all([
    context.store.sourceHeadTimes(
      site,
      source,
      translations.map((view) => ({
        collection: view.entry.collection,
        group: view.entry.translationGroup ?? '',
      })),
    ),
    context.store.revisionTimes(
      site,
      translations.map((view) => view.entry.headRevision),
    ),
  ])
  return new Map(
    translations.map((view) => {
      const source = sources.get(`${view.entry.collection}\0${view.entry.translationGroup ?? ''}`)
      const ownAt = own.get(view.entry.headRevision)
      return [
        view.entry.id,
        source !== undefined && ownAt !== undefined && source.first < ownAt && source.head > ownAt,
      ] as const
    }),
  )
}
