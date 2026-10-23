import { referencedSlugs, renderHtml, resolveAssetReferences } from '@hollware/core'
import type { EntryView } from '../ports.ts'
import { assetUrlOf, forReaders, imagesNamed, readsUrls, summaryImages } from './assets.ts'
import { automaticValues, summaryFor } from './automatic.ts'
import { translationOutdated } from './translations.ts'
import { publicationView, verdictView, type EntrySummary as EntrySummaryOutput } from './answers.ts'
import { collectionOfEntry, requireCollection, requireLocale } from './collections.ts'
import type { OperationContext, OperationHandler } from './types.ts'

export const getEntry: OperationHandler<'get_entry'> = async (input, context) => {
  requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  const found = await context.store.findEntry(
    context.site.key,
    { collection: input.collection, locale: input.locale, slug: input.slug },
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
