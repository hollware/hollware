import { actorOf } from './actor.ts'
import { entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { judge, processFor, revisionOf, translationGroupOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import type { OperationHandler } from './types.ts'

/**
 * Creates an entry at version 1 from a Markdown file. A file the pipeline cannot store is
 * `refused`; any other problem, a contract error included, is saved with the draft in its verdict
 * and only blocks publishing (ADR-004). The store refuses a slug or a translation that another
 * entry holds, and a row over the limit of D1, and those are `refused` too.
 */
export const createDraft: OperationHandler<'create_draft'> = async (input, context) => {
  const collection = requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  const actor = actorOf(context)
  const processed = await processFor(context.site, collection, input.markdown)
  // A file the pipeline cannot store is refused; every other problem is saved with the draft.
  if (!processed.ok) {
    return { outcome: 'refused', verdict: refusalVerdict('write', processed.violations) }
  }
  const verdict = await judge(
    context,
    collection,
    { locale: input.locale, slug: input.slug, entryId: null },
    processed.value,
    'write',
  )
  const written = await context.store.createEntry(context.site.key, {
    collection: input.collection,
    locale: input.locale,
    slug: input.slug,
    translationGroup: translationGroupOf(collection, processed.value.frontmatter),
    revision: revisionOf({
      markdown: input.markdown,
      processed: processed.value,
      collection,
      verdict,
      actor,
    }),
  })
  switch (written.outcome) {
    case 'saved':
      // Contract errors do not stop a draft: the verdict says what to fix before publishing.
      return { outcome: 'saved', entry: entrySummary(written.view), verdict: verdictView(verdict) }
    case 'taken':
    case 'too_large':
      return {
        outcome: 'refused',
        verdict: refusalVerdict('write', [violationOf(written, collection)]),
      }
    case 'conflict':
    case 'not_found':
      throw unexpectedAnswer(context, 'createEntry', written)
  }
}
