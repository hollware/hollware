import { renderHtml, resolveAssetReferences } from '@hollware/core'
import { assetUrlOf, forReaders } from './assets.ts'
import { translationOutdated } from './translations.ts'
import { entrySummary, publicationView, verdictView } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import type { OperationContext, OperationHandler } from './types.ts'

/**
 * Reads an entry in the view of the call, `head` over MCP and `published` over RPC, or in the
 * published view when the input asks for it, with only the formats that were asked for.
 */
export const getEntry: OperationHandler<'get_entry'> = async (input, context) => {
  requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  const found = await context.store.findEntry(
    context.site.key,
    { collection: input.collection, locale: input.locale, slug: input.slug },
    // `published` narrows a call to what is live; a call that reads only that stays there.
    input.published ? 'published' : context.view,
  )
  if (found === null) return { outcome: 'not_found' }
  const { entry, revision } = found
  const [publication, unpublishAt, outdated] = await Promise.all([
    context.store.lastPublication(context.site.key, entry.id),
    context.store.unpublishOf(context.site.key, entry.id),
    translationOutdated(context, [found]),
  ])
  const stale = outdated.get(entry.id)
  const related = input.related ? await relatedEntries(context, entry.id) : undefined
  return {
    outcome: 'ok',
    entry: {
      ...forReaders(context, {
        ...entrySummary(found),
        ...(stale === undefined ? {} : { translationOutdated: stale }),
      }),
      revision: revision.id,
      unpublishAt,
      verdict: verdictView(revision.verdict),
      lastPublication: publicationView(publication),
      // Only what was asked for: a document or its HTML can weigh megabytes.
      ...(input.formats.includes('markdown') ? { markdown: revision.markdown } : {}),
      ...(input.formats.includes('document')
        ? { document: forReaders(context, revision.document) }
        : {}),
      // HTML is for showing: its images are always the URLs where the Worker serves them.
      ...(input.formats.includes('html')
        ? {
            html: await renderHtml(resolveAssetReferences(revision.document, assetUrlOf(context))),
          }
        : {}),
    },
    ...(related === undefined ? {} : { related }),
  }
}

/**
 * The published entries closest to one, as its vectors found them when it was indexed: none when
 * the deployment has no semantic search, and none that is no longer published.
 */
async function relatedEntries(context: OperationContext, entryId: string) {
  if ((context.semantic ?? null) === null) return []
  const related = await context.store.relatedOf(context.site.key, entryId)
  const summaries = await context.store.findSummaries(
    context.site.key,
    related.map((item) => item.id),
    'published',
  )
  return summaries.map((summary) => forReaders(context, entrySummary(summary)))
}
