import { MAX_ROW_BYTES } from '../limits.ts'
import type { WriteRefusal } from '../ports.ts'

/**
 * D1 refuses rows over 2 MB, and Miniflare does not enforce it, so the store counts the bytes of
 * a row before writing it and refuses a row over `MAX_ROW_BYTES` (`limits.ts`).
 */

const encoder = new TextEncoder()

/** The bytes of `text` in UTF-8, which is how D1 stores it. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}

/** What SQLite keeps for an integer, at most. */
const INTEGER_BYTES = 8

/** A row as the store binds it: one value per column. */
export type RowValues = Readonly<Record<string, string | number | null>>

/** The bytes of every column of a row: text in UTF-8, an integer as 8 bytes, a null as none. */
export function rowBytes(row: RowValues): number {
  let bytes = 0
  for (const value of Object.values(row)) {
    if (typeof value === 'string') bytes += utf8Bytes(value)
    else if (value !== null) bytes += INTEGER_BYTES
  }
  return bytes
}

/** The refusal for a row over the limit, or `null` when it fits. */
export function tooLarge(row: RowValues): Extract<WriteRefusal, { outcome: 'too_large' }> | null {
  const bytes = rowBytes(row)
  return bytes > MAX_ROW_BYTES ? { outcome: 'too_large', bytes, limit: MAX_ROW_BYTES } : null
}
