import { eventFor } from './event.ts'
import { actorOf } from './actor.ts'
import { collectionOfEntry } from './collections.ts'
import { entrySummary } from './answers.ts'
import { unexpectedAnswer } from './errors.ts'
import type { OperationHandler } from './types.ts'

/**
 * Takes an entry off the public site and keeps it, with its revisions, as a draft. The store
 * leaves an entry that is not published as it is.
 */
export const unpublish: OperationHandler<'unpublish'> = async (input, context) => {
  const actor = actorOf(context)
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const { entry } = found
  // The event is written only if the entry is published when the batch runs (ADR-025).
  const event = eventFor({
    kind: 'entry.unpublished',
    site: context.site,
    collection: collectionOfEntry(context.site, entry),
    entry: {
      id: entry.id,
      collection: entry.collection,
      locale: entry.locale,
      slug: entry.slug,
      translationGroup: entry.translationGroup,
    },
    at: context.clock.now().toISOString(),
  })
  const written = await context.store.unpublish(context.site.key, {
    entryId: input.id,
    actor,
    event,
  })
  switch (written.outcome) {
    case 'unpublished':
      if (entry.status === 'published') context.notify?.([event.id])
      return { outcome: 'unpublished', entry: entrySummary(written.view) }
    case 'not_found':
      return { outcome: 'not_found' }
    case 'conflict':
    case 'taken':
    case 'too_large':
      throw unexpectedAnswer(context, 'unpublish', written)
  }
}
