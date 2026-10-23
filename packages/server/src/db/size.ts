import { MAX_ROW_BYTES } from '../limits.ts'
import type { WriteRefusal } from '../ports.ts'

const encoder = new TextEncoder()

export function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}

const INTEGER_BYTES = 8

export type RowValues = Readonly<Record<string, string | number | null>>

export function rowBytes(row: RowValues): number {
  let bytes = 0
  for (const value of Object.values(row)) {
    if (typeof value === 'string') bytes += utf8Bytes(value)
    else if (value !== null) bytes += INTEGER_BYTES
  }
  return bytes
}

export function tooLarge(row: RowValues): Extract<WriteRefusal, { outcome: 'too_large' }> | null {
  const bytes = rowBytes(row)
  return bytes > MAX_ROW_BYTES ? { outcome: 'too_large', bytes, limit: MAX_ROW_BYTES } : null
}
