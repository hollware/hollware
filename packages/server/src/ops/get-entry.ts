import { referencedSlugs, renderHtml, resolveAssetReferences } from '@hollware/core'
import type { EntryView } from '../ports.ts'
import { assetUrlOf, forReaders, imagesNamed, readsUrls, summaryImages } from './assets.ts'
import { automaticValues, summaryFor } from './automatic.ts'
import { translationOutdated } from './translations.ts'
import { publicationView, verdictView, type EntrySummary as EntrySummaryOutput } from './answers.ts'
import { collectionOfEntry, requireCollection, requireLocale } from './collections.ts'
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
  const summary = summaryFor(context, found)
  const automatic = automaticValues(context, found)
  const html = input.formats.includes('html')
  const urls = readsUrls(context)
  // The images a reader lays out: those of the frontmatter, and those of the document it renders.
  const images =
    urls || html
      ? await imagesNamed(context, [
          urls ? summary.frontmatter : null,
          html || (urls && input.formats.includes('document')) ? revision.document : null,
        ])
      : new Map()
  const imageOf = (id: string) => images.get(id)
  const related = input.related ? await relatedEntries(context, entry.id) : undefined
  const references = input.references ? await referencedEntries(context, found) : undefined
  return {
    outcome: 'ok',
    entry: {
      ...forReaders(context, {
        ...summary,
        ...(stale === undefined ? {} : { translationOutdated: stale }),
      }),
      ...summaryImages(context, summary.frontmatter, images),
      revision: revision.id,
      ...(Object.keys(automatic).length === 0 ? {} : { automatic }),
      unpublishAt,
      verdict: verdictView(revision.verdict),
      lastPublication: publicationView(publication),
      // Only what was asked for: a document or its HTML can weigh megabytes.
      ...(input.formats.includes('markdown') ? { markdown: revision.markdown } : {}),
      ...(input.formats.includes('document')
        ? {
            document: urls
              ? {
                  ...resolveAssetReferences(revision.document, assetUrlOf(context), imageOf),
                  frontmatter: forReaders(context, summary.frontmatter),
                }
              : revision.document,
          }
        : {}),
      // HTML is for showing: its images are always the URLs where the Worker serves them, with
      // their size and srcset.
      ...(html
        ? {
            html: await renderHtml(
              resolveAssetReferences(revision.document, assetUrlOf(context), imageOf),
            ),
          }
        : {}),
    },
    ...(related === undefined ? {} : { related }),
    ...(references === undefined ? {} : { references }),
  }
}

/**
 * The published entries that the reference rules of the entry's collection name, by field, in the
 * order each field names them: what a page shows of an author or a series. One that is missing
 * or not published is left out; the rule says so when publishing.
 */
async function referencedEntries(context: OperationContext, found: EntryView) {
  const collection = collectionOfEntry(context.site, found.entry)
  const answer: Record<string, EntrySummaryOutput[]> = {}
  for (const contract of collection.contracts) {
    if (contract.rule?.name !== 'reference') continue
    const params = contract.rule.params
    const field = params['field']
    const target = params['collection']
    if (typeof field !== 'string' || typeof target !== 'string') continue
    const locale = typeof params['locale'] === 'string' ? params['locale'] : found.entry.locale
    const named = referencedSlugs(found.revision.frontmatter[field]).slice(0, 50)
    const views = await Promise.all(
      named.map((slug) =>
        context.store.findEntry(
          context.site.key,
          { collection: target, locale, slug },
          'published',
        ),
      ),
    )
    answer[field] = views.flatMap((view) =>
      view === null ? [] : [forReaders(context, summaryFor(context, view))],
    )
  }
  return answer
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
  return summaries.map((summary) => forReaders(context, summaryFor(context, summary)))
}
