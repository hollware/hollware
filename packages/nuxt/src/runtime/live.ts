import { PREVIEW_ENTRY_MESSAGE } from '@hollware/core'
import { forPage } from './page-fields.ts'

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function liveEntryOf(message: unknown): Fields | null {
  if (!isRecord(message) || message['type'] !== PREVIEW_ENTRY_MESSAGE) return null
  const entry = forPage(message['entry'])
  return entry !== undefined && typeof entry['id'] === 'string' ? entry : null
}

export function withLiveEntry(answer: unknown, entry: Fields): Fields | null {
  if (!isRecord(answer)) return null
  const read = answer['entry']
  if (!isRecord(read) || read['id'] !== entry['id']) return null
  return { ...answer, entry: { ...read, ...entry } }
}
