import { CLIENT_CAPABILITIES_META_KEY, CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const MAX_CLIENT_FIELD_LENGTH = 120

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

export function canElicitForm(era: 'legacy' | 'modern', envelope: unknown): boolean {
  if (era !== 'modern' || !isRecord(envelope)) return false
  const capabilities = envelope[CLIENT_CAPABILITIES_META_KEY]
  const elicitation = isRecord(capabilities) ? capabilities.elicitation : undefined
  if (!isRecord(elicitation)) return false
  return elicitation.form !== undefined || elicitation.url === undefined
}
