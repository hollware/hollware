import { renderHtml } from '@hollware/core'
import { entrySummary, publicationView, verdictView } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import type { OperationHandler } from './types.ts'

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
  const publication = await context.store.lastPublication(context.site.key, entry.id)
  return {
    outcome: 'ok',
    entry: {
      ...entrySummary(found),
      revision: revision.id,
      verdict: verdictView(revision.verdict),
      lastPublication: publicationView(publication),
      // Only what was asked for: a document or its HTML can weigh megabytes.
      ...(input.formats.includes('markdown') ? { markdown: revision.markdown } : {}),
      ...(input.formats.includes('document') ? { document: revision.document } : {}),
      ...(input.formats.includes('html') ? { html: await renderHtml(revision.document) } : {}),
    },
  }
}
