import { HollwareError } from '@hollware/core'

import type { View } from '../ports.ts'

/**
 * The cursor of a listing is opaque to callers: base64url of the JSON `{ v, k, i }`, the view the
 * page was listed in, and the sort key and id of its last entry. The next page is what comes
 * after that position, so a page never repeats or skips an entry that did not change.
 */

/** Where a page ended. */
export interface CursorPosition {
  /** The value the view sorts by: `updated_at` of the `head` view, `published_sort_key` otherwise. */
  readonly key: string
  readonly id: string
}

function invalidCursor(): HollwareError {
  return new HollwareError(
    'invalid_input',
    'The cursor is not valid for this listing.',
    'Pass the nextCursor of the previous answer unchanged, to the same operation, or leave cursor out to start from the first page.',
  )
}

function encodeBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** The text a base64url string holds, or `null` when it is not base64url of UTF-8. */
function decodeBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null
  try {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return null
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The cursor that continues a `view` listing after `position`. */
export function encodeCursor(view: View, position: CursorPosition): string {
  return encodeBase64Url(JSON.stringify({ v: view, k: position.key, i: position.id }))
}

/**
 * The position a cursor stands for. A cursor that no listing of this view returned, whatever is
 * wrong with it, is the error `invalid_input` with a fix.
 */
export function decodeCursor(cursor: string, view: View): CursorPosition {
  const text = decodeBase64Url(cursor)
  const value = text === null ? undefined : parseJson(text)
  if (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    'k' in value &&
    'i' in value &&
    value.v === view &&
    typeof value.k === 'string' &&
    typeof value.i === 'string'
  ) {
    return { key: value.k, id: value.i }
  }
  throw invalidCursor()
}
