import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server'

/**
 * What a client says about itself. A 2026-07-28 client says it on every request, in the `_meta`
 * envelope; a 2025-11-25 client says it once, in `initialize`, and the stateless fallback that
 * serves those clients keeps nothing between requests, so for them there is nothing to read.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The longest name, version or title kept of a client: it is recorded with what it writes. */
const MAX_CLIENT_FIELD_LENGTH = 120

/**
 * The client as the envelope names it: its name, and its version and title when it gives them,
 * each cut short. A client could write anything there, and what it writes is stored with every
 * revision and publication it makes. `null` when the request has no envelope.
 */
export function declaredClient(envelope: unknown): Readonly<Record<string, string>> | null {
  const info = isRecord(envelope) ? envelope[CLIENT_INFO_META_KEY] : undefined
  if (!isRecord(info) || typeof info.name !== 'string') return null
  const client: Record<string, string> = { name: info.name.slice(0, MAX_CLIENT_FIELD_LENGTH) }
  if (typeof info.version === 'string') {
    client.version = info.version.slice(0, MAX_CLIENT_FIELD_LENGTH)
  }
  if (typeof info.title === 'string') client.title = info.title.slice(0, MAX_CLIENT_FIELD_LENGTH)
  return client
}

/**
 * Whether the server may ask the client a question in a form, as a multi round-trip request: the
 * request is in the 2026 era, and the client declared the elicitation capability for forms. A
 * bare `elicitation: {}` counts as forms, as it does for the SDK, which answers `-32021` to a
 * question that the client did not declare; `{ url: {} }` alone does not. A 2025 client in the
 * stateless fallback can never be asked: that fallback has no way to send a request to a client.
 */
export function canElicitForm(era: 'legacy' | 'modern', envelope: unknown): boolean {
  if (era !== 'modern' || !isRecord(envelope)) return false
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY]
  const elicitation = isRecord(capabilities) ? capabilities.elicitation : undefined
  if (!isRecord(elicitation)) return false
  return elicitation.form !== undefined || elicitation.url === undefined
}
