/**
 * The signature of Hollware's webhooks, for the Worker that sends them and for whoever
 * receives them: HMAC-SHA256 of `<timestamp>.<body>` with the webhook's secret, sent as
 * `hollware-signature: v1=<hex>` with `hollware-timestamp` (seconds since the epoch) and
 * `hollware-event-id`. Web Crypto only, so it runs in any runtime.
 */

export const SIGNATURE_HEADER = 'hollware-signature'
export const TIMESTAMP_HEADER = 'hollware-timestamp'
export const EVENT_ID_HEADER = 'hollware-event-id'

const TOLERANCE_SECONDS = 300

const encoder = new TextEncoder()

async function hmac(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))
  return [...signature].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The value of `hollware-signature` for a body sent at `timestamp` (seconds). */
export async function signWebhook(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return `v1=${await hmac(secret, `${timestamp}.${body}`)}`
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

export interface WebhookCheck {
  readonly secret: string
  /** The raw body, as received: a parsed and re-serialized body no longer matches. */
  readonly body: string
  readonly headers: Headers
  /** Now, in seconds since the epoch; the system clock when absent. */
  readonly now?: number
  readonly toleranceSeconds?: number
  /**
   * Whether the receiver sees this event for the first time, given its id, and records it:
   * a request captured and sent again within the tolerance is then refused. The id is read from
   * the signed body, never from `hollware-event-id`, which no signature covers. A retry of a
   * delivery carries the same id, so a receiver that records an id only once it has handled the
   * event lets a failed delivery be retried. Keep each id for longer than the tolerance.
   */
  readonly isNew?: (eventId: string) => boolean | Promise<boolean>
}

function eventIdOf(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body)
    const id: unknown =
      typeof value === 'object' && value !== null ? Reflect.get(value, 'id') : null
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

/**
 * Whether a request is a webhook of Hollware: its signature matches the body and the secret, and
 * its timestamp is within the tolerance, so a captured request cannot be replayed later; with
 * `isNew`, also that its event was not received before, so it cannot be replayed sooner either.
 */
export async function verifyWebhook(check: WebhookCheck): Promise<boolean> {
  if (check.secret === '') return false
  const signature = check.headers.get(SIGNATURE_HEADER)
  const timestamp = Number(check.headers.get(TIMESTAMP_HEADER))
  if (signature === null || !Number.isInteger(timestamp)) return false
  const now = check.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > (check.toleranceSeconds ?? TOLERANCE_SECONDS)) return false
  if (!sameText(signature, await signWebhook(check.secret, timestamp, check.body))) return false
  if (check.isNew === undefined) return true
  const id = eventIdOf(check.body)
  return id !== null && (await check.isNew(id))
}
