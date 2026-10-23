import { actorOf } from './actor.ts'
import { entrySummary } from './answers.ts'
import type { OperationHandler } from './types.ts'
import { unpublish } from './unpublish.ts'

export const scheduleUnpublish: OperationHandler<'schedule_unpublish'> = async (input, context) => {
  const site = context.site.key
  const found = await context.store.findEntryById(site, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  if (input.unpublishAt === null) {
    await context.store.cancelUnpublish(site, input.id)
    return { outcome: 'cancelled', entry: entrySummary(found), unpublishAt: null }
  }
  if (found.entry.status !== 'published')
    return { outcome: 'not_published', entry: entrySummary(found) }
  const at = new Date(input.unpublishAt)
  if (at.getTime() <= context.clock.now().getTime()) {
    const now = await unpublish({ id: input.id }, context)
    return now.outcome === 'unpublished'
      ? { outcome: 'unpublished', ...(now.entry === undefined ? {} : { entry: now.entry }) }
      : { outcome: 'not_found' }
  }
  const written = await context.store.scheduleUnpublish(site, {
    entryId: input.id,
    at: at.toISOString(),
    actor: actorOf(context),
  })
  if (written !== 'scheduled') return { outcome: written }
  return { outcome: 'scheduled', entry: entrySummary(found), unpublishAt: at.toISOString() }
}
