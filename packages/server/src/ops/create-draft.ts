import { actorOf } from './actor.ts'
import { entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { formatFor, judge, revisionOf, translationGroupOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import type { OperationHandler } from './types.ts'

export const createDraft: OperationHandler<'create_draft'> = async (input, context) => {
  const collection = requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  const actor = actorOf(context)
  const { markdown, processed } = await formatFor(context.site, collection, input.markdown)
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
      markdown,
      processed: processed.value,
      collection,
      verdict,
      actor,
    }),
  })
  switch (written.outcome) {
    case 'saved':
      return {
        outcome: 'saved',
        entry: entrySummary(written.view),
        markdown,
        verdict: verdictView(verdict),
      }
    case 'in_trash':
      return { outcome: 'in_trash', entry: entrySummary(written.view) }
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
