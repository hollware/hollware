import type { EntrySummaryView } from '../ports.ts'
import type { OperationContext } from './types.ts'

/**
 * Which of these entries are translations that their source has moved past: the entry of their
 * translation group in the default locale of the site existed when they were last saved, and has
 * a revision written after that. A translation written before its source is not behind it. A translator (a person or the agent of `@hollware/agents`) saves the translation
 * again, and it is up to date. Only entries in another locale than the default, with a group,
 * have an answer; the others are left out of the map.
 */
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
