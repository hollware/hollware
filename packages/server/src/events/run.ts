import type { Db } from '../db/d1.ts'
import { markSent, unsentEvents } from '../db/events.ts'
import type { Clock } from '../ports.ts'
import { deliverEvent, type DeliveryDeps } from './deliver.ts'

/** A message of the events Queue: the site and the id of an outbox row. */
export interface EventMessage {
  readonly site: string
  readonly id: string
}

/** The part of a Queue binding that sends. */
export interface EventQueue {
  sendBatch(messages: Iterable<{ readonly body: EventMessage }>): Promise<unknown>
}

/**
 * Puts events on the Queue and marks them sent. Without a Queue binding nothing is sent: the
 * sweep of the cron trigger delivers them instead, within a minute.
 */
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

/**
 * What the cron trigger does with the outbox: an event that was never put on the Queue (its
 * request ended before, or the project has no Queue) is put on it, or, without a Queue, delivered
 * here. An event delivered here is marked sent only when every subscriber has it.
 */
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

/** The part of a Queue message the consumer uses; its body is checked before use. */
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

/**
 * The Queue consumer: delivers each event, acknowledges it once every subscriber has it, and asks
 * for a retry otherwise; after the Queue's retries it lands in the dead-letter queue. A message of
 * another site, or that is no event, is acknowledged and dropped.
 */
export async function consumeEvents(
  messages: readonly EventDelivery[],
  deps: DeliveryDeps,
): Promise<void> {
  for (const message of messages) {
    const { body } = message
    if (!isEventMessage(body) || body.site !== deps.site.key) {
      message.ack()
      continue
    }
    const result = await deliverEvent(deps, body.id)
    if (result.failed.length === 0) message.ack()
    else message.retry()
  }
}
