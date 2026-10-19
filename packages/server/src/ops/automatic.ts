import { withAutomaticFields } from '@hollware/core'
import type { EntrySummaryView } from '../ports.ts'
import { entrySummary, type EntrySummary } from './answers.ts'
import { readsUrls } from './assets.ts'
import type { OperationContext } from './types.ts'

/*
 * The fields Hollware fills itself (`automaticFields` of a collection, core's `automatic.ts`): a
 * site reads them filled, an agent over MCP reads what was written, and `get_entry` answers their
 * values apart, for an export that writes what a site reads.
 */

/** The values of the fields the collection fills, for the revision of a view; none when it fills none. */
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

/** The summary of an entry as the call reads it: for a site, with the fields Hollware fills. */
export function summaryFor(
  context: Pick<OperationContext, 'site' | 'view' | 'reader'>,
  view: EntrySummaryView,
): EntrySummary {
  const summary = entrySummary(view)
  return readsUrls(context)
    ? { ...summary, frontmatter: { ...summary.frontmatter, ...automaticValues(context, view) } }
    : summary
}
