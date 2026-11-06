import { parentViolation } from '@hollware/core'
import { actorOf } from './actor.ts'
import { entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { formatFor, judge, revisionOf, translationGroupOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import { parentFor, TREE_ATTEMPTS, treeOf } from './tree.ts'
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
  const refusedUnder = (problem: Parameters<typeof parentViolation>[0]) => ({
    outcome: 'refused' as const,
    verdict: refusalVerdict('write', [
      parentViolation(problem, {
        parent: input.parent ?? '',
        maxDepth: collection.nesting?.maxDepth ?? null,
      }),
    ]),
  })
  for (let attempt = 1; attempt <= TREE_ATTEMPTS; attempt += 1) {
    const placed =
      input.parent === undefined
        ? null
        : await parentFor(context, collection, input.locale, input.parent, 1)
    if (placed !== null && 'problem' in placed) return refusedUnder(placed.problem)
    const written = await context.store.createEntry(context.site.key, {
      collection: input.collection,
      locale: input.locale,
      slug: input.slug,
      translationGroup: translationGroupOf(collection, processed.value.frontmatter),
      tree: treeOf(context.site, input.collection, input.locale),
      parent: placed === null ? null : { id: placed.parent.id, slugPath: placed.parent.slugPath },
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
      case 'tree_changed':
        continue
      case 'conflict':
      case 'not_found':
        throw unexpectedAnswer(context, 'createEntry', written)
    }
  }
  return refusedUnder('changed')
}
