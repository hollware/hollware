import { withAutomaticFields } from '@hollware/core'
import type { EntrySummaryView } from '../ports.ts'
import { entrySummary, type EntrySummary } from './answers.ts'
import { readsUrls } from './assets.ts'
import { entryPath } from './event.ts'
import type { OperationContext } from './types.ts'

export function automaticValues(
  context: Pick<OperationContext, 'site'>,
  view: EntrySummaryView,
): Record<string, unknown> {
  const fields = context.site.collections.get(view.entry.collection)?.automaticFields ?? {}
  const names = Object.keys(fields)
  if (names.length === 0) return {}
  const filled = withAutomaticFields(
    fields,
    {
      publishedAt: view.entry.publishedAt,
      revisionCreatedAt: view.revision.createdAt,
      wordCount: view.revision.wordCount,
      codeWords: view.revision.codeWords,
    },
    view.revision.frontmatter,
  )
  return Object.fromEntries(
    names.filter((name) => Object.hasOwn(filled, name)).map((name) => [name, filled[name]]),
  )
}

export function summaryFor(
  context: Pick<OperationContext, 'site' | 'view' | 'reader'>,
  view: EntrySummaryView,
): EntrySummary {
  const collection = context.site.collections.get(view.entry.collection)
  const summary = {
    ...entrySummary(view),
    path:
      collection === undefined
        ? null
        : entryPath(collection, view.entry.locale, view.entry.slugPath),
  }
  return readsUrls(context)
    ? { ...summary, frontmatter: { ...summary.frontmatter, ...automaticValues(context, view) } }
    : summary
}
