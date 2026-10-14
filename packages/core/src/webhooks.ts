/**
 * The signature of Hollware's webhooks (ADR-025), for the Worker that sends them and for whoever
 * receives them: HMAC-SHA256 of `<timestamp>.<body>` with the webhook's secret, sent as
 * `hollware-signature: v1=<hex>` with `hollware-timestamp` (seconds since the epoch) and
 * `hollware-event-id`. Web Crypto only, so it runs in any runtime.
 */

export const SIGNATURE_HEADER = 'hollware-signature'
export const TIMESTAMP_HEADER = 'hollware-timestamp'
export const EVENT_ID_HEADER = 'hollware-event-id'

/** How far a timestamp may be from the receiver's clock, by default: five minutes. */
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

/** Compares two strings in time that does not depend on where they differ. */
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
}

/**
 * Whether a request is a webhook of Hollware: its signature matches the body and the secret, and
 * its timestamp is within the tolerance, so a captured request cannot be replayed later.
 */
export async function verifyWebhook(check: WebhookCheck): Promise<boolean> {
  const signature = check.headers.get(SIGNATURE_HEADER)
  const timestamp = Number(check.headers.get(TIMESTAMP_HEADER))
  if (signature === null || !Number.isInteger(timestamp)) return false
  const now = check.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > (check.toleranceSeconds ?? TOLERANCE_SECONDS)) return false
  return sameText(signature, await signWebhook(check.secret, timestamp, check.body))
}
