import type { Db } from '../db/d1.ts'
import { markSent, unsentEvents } from '../db/events.ts'
import type { Clock } from '../ports.ts'
import { deliverEvent, type DeliveryDeps } from './deliver.ts'

/** A message of the events Queue: the site and the id of an outbox row. */
export interface EventMessage {
  readonly site: string
  readonly id: string
}

export interface EventQueue {
  sendBatch(messages: Iterable<{ readonly body: EventMessage }>): Promise<unknown>
}

export async function enqueue(input: {
  readonly queue: EventQueue | undefined
  readonly db: Db
  readonly site: string
  readonly ids: readonly string[]
  readonly clock: Clock
}): Promise<void> {
  if (input.queue === undefined || input.ids.length === 0) return
  await input.queue.sendBatch(input.ids.map((id) => ({ body: { site: input.site, id } })))
  await markSent(input.db, input.site, input.ids, input.clock.now().toISOString())
}

export async function sweepOutbox(input: {
  readonly queue: EventQueue | undefined
  readonly deps: DeliveryDeps
}): Promise<{ readonly swept: number }> {
  const { deps, queue } = input
  const now = deps.clock.now().toISOString()
  const ids = await unsentEvents(deps.db, deps.site.key, now)
  if (queue !== undefined) {
    await enqueue({ queue, db: deps.db, site: deps.site.key, ids, clock: deps.clock })
    return { swept: ids.length }
  }
  for (const id of ids) {
    const result = await deliverEvent(deps, id)
    if (result.failed.length === 0) await markSent(deps.db, deps.site.key, [id], now)
  }
  return { swept: ids.length }
}

export interface EventDelivery {
  readonly body: unknown
  ack(): void
  retry(): void
}

function isEventMessage(body: unknown): body is EventMessage {
  return (
    typeof body === 'object' &&
    body !== null &&
    'site' in body &&
    'id' in body &&
    typeof body.site === 'string' &&
    typeof body.id === 'string'
  )
}

export async function consumeEvents(
  messages: readonly EventDelivery[],
  depsOf: (site: string) => DeliveryDeps | undefined,
): Promise<void> {
  for (const message of messages) {
    const { body } = message
    const deps = isEventMessage(body) ? depsOf(body.site) : undefined
    if (!isEventMessage(body) || deps === undefined) {
      message.ack()
      continue
    }
    const result = await deliverEvent(deps, body.id)
    if (result.failed.length === 0) message.ack()
    else message.retry()
  }
}
