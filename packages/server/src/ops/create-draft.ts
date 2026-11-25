import { HollwareError, parentViolation, type ResolvedCollection } from '@hollware/core'
import { actorOf } from './actor.ts'
import { entrySummary, refusalVerdict, verdictView, violationOf } from './answers.ts'
import { requireCollection, requireLocale } from './collections.ts'
import { formatFor, judge, revisionOf, translationGroupOf } from './draft.ts'
import { unexpectedAnswer } from './errors.ts'
import { parentFor, TREE_ATTEMPTS, treeOf } from './tree.ts'
import type { OperationContext, OperationHandler } from './types.ts'

export const createDraft: OperationHandler<'create_draft'> = async (input, context) => {
  const collection = requireCollection(context.site, input.collection)
  requireLocale(context.site, input.locale)
  if (collection.singleton) await refuseSecondSingleton(context, collection, input.locale)
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

async function refuseSecondSingleton(
  context: OperationContext,
  collection: ResolvedCollection,
  locale: string,
): Promise<void> {
  const page = await context.store.listEntries(context.site.key, {
    collection: collection.name,
    locale,
    view: 'head',
    limit: 1,
  })
  const held = page.entries[0]
  if (held === undefined) return
  throw new HollwareError(
    'invalid_input',
    `The collection ${JSON.stringify(collection.name)} is a singleton and already holds its entry in ${locale}: ${JSON.stringify(held.entry.slug)}.`,
    `Change that entry with update_draft (read it with get_entry, slug ${JSON.stringify(held.entry.slug)}), or create the entry in another locale of the site.`,
  )
}
