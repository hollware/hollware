import { actorOf } from './actor.ts'
import { entrySummary } from './answers.ts'
import { unexpectedAnswer } from './errors.ts'
import type { OperationHandler } from './types.ts'

/**
 * Takes an entry off the public site and keeps it, with its revisions, as a draft. The store
 * leaves an entry that is not published as it is.
 */
export const unpublish: OperationHandler<'unpublish'> = async (input, context) => {
  const actor = actorOf(context)
  const written = await context.store.unpublish(context.site.key, { entryId: input.id, actor })
  switch (written.outcome) {
    case 'unpublished':
      return { outcome: 'unpublished', entry: entrySummary(written.view) }
    case 'not_found':
      return { outcome: 'not_found' }
    case 'conflict':
    case 'taken':
    case 'too_large':
      throw unexpectedAnswer(context, 'unpublish', written)
  }
}
