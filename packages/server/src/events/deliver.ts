import {
  EVENT_ID_HEADER,
  SIGNATURE_HEADER,
  signWebhook,
  TIMESTAMP_HEADER,
  type ResolvedSite,
} from '@hollware/core'
import type { Db } from '../db/d1.ts'
import { deliveredTo, findEvent, recordAttempt } from '../db/events.ts'
import type { Clock } from '../ports.ts'
import type { EventPayload } from '../ops/event.ts'
import type { Semantic } from '../ports.ts'
import { syncEntryVectors } from '../semantic/index-entry.ts'

/** Where IndexNow takes the URLs that changed. */
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/** A subscriber of a site: a name for the deliveries table, and how to send it an event. */
interface Subscriber {
  readonly name: string
  send(payload: EventPayload, body: string): Promise<void>
}

export interface DeliveryDeps {
  readonly db: Db
  readonly site: ResolvedSite
  readonly clock: Clock
  /** `fetch`, given so that tests never reach the network. */
  readonly fetch: (request: Request) => Promise<Response>
  /** The value of a Worker secret by its name, or `undefined` when it is not set. */
  readonly secret: (name: string) => string | undefined
  /** The model and the vector index, when the Worker has both; semantic search is off without. */
  readonly semantic?: Semantic | null
}

async function ensureOk(response: Response, what: string): Promise<void> {
  if (response.ok) return
  throw new Error(`${what} answered ${response.status}`)
}

/** The subscribers that the config of the site declares (ADR-025). */
export function subscribersOf(deps: DeliveryDeps): Subscriber[] {
  const { site } = deps
  const subscribers: Subscriber[] = site.events.webhooks.map((webhook) => ({
    name: `webhook:${webhook.name}`,
    async send(payload, body) {
      const secret = deps.secret(webhook.secret)
      if (secret === undefined) throw new Error(`the secret ${webhook.secret} is not set`)
      const timestamp = Math.floor(deps.clock.now().getTime() / 1000)
      const request = new Request(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [EVENT_ID_HEADER]: payload.id,
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: await signWebhook(secret, timestamp, body),
        },
        body,
      })
      await ensureOk(await deps.fetch(request), `the webhook ${webhook.name}`)
    },
  }))
  const indexNow = site.events.indexNow
  if (indexNow !== null && site.url !== null) {
    const host = new URL(site.url).host
    subscribers.push({
      name: 'indexnow',
      async send(payload) {
        if (payload.url === null) return
        const key = deps.secret(indexNow.key)
        if (key === undefined) throw new Error(`the secret ${indexNow.key} is not set`)
        const request = new Request(INDEXNOW_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ host, key, urlList: [payload.url] }),
        })
        await ensureOk(await deps.fetch(request), 'IndexNow')
      },
    })
  }
  const semantic = deps.semantic
  if (semantic !== undefined && semantic !== null) {
    // Hollware's own subscriber: the vectors follow what is published, whichever the event.
    subscribers.push({
      name: 'vectors',
      async send(payload) {
        await syncEntryVectors(deps.db, semantic, {
          site: site.key,
          entryId: payload.entry.id,
          now: deps.clock.now().toISOString(),
        })
      },
    })
  }
  return subscribers
}

export interface DeliveryResult {
  readonly delivered: readonly string[]
  readonly failed: readonly string[]
}

/**
 * Delivers one event of the outbox to every subscriber that does not have it yet, and records each
 * attempt. A subscriber that fails is tried again on the next delivery of the event, and one that
 * succeeded is never sent it again: the caller retries the message while `failed` is not empty.
 * An event that is gone, or a site without subscribers, delivers nothing.
 */
export async function deliverEvent(deps: DeliveryDeps, eventId: string): Promise<DeliveryResult> {
  const event = await findEvent(deps.db, deps.site.key, eventId)
  if (event === null) return { delivered: [], failed: [] }
  const payload: EventPayload = JSON.parse(event.payload)
  const done = await deliveredTo(deps.db, deps.site.key, eventId)
  const delivered: string[] = []
  const failed: string[] = []
  for (const subscriber of subscribersOf(deps)) {
    if (done.has(subscriber.name)) continue
    let error: string | null = null
    try {
      await subscriber.send(payload, event.payload)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    await recordAttempt(deps.db, {
      site: deps.site.key,
      eventId,
      subscriber: subscriber.name,
      now: deps.clock.now().toISOString(),
      error,
    })
    ;(error === null ? delivered : failed).push(subscriber.name)
  }
  return { delivered, failed }
}
