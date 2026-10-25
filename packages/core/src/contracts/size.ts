import type { Violation } from './types.ts'

/**
 * The `size-limit` violation of the row that D1 holds, which the store checks against
 * `MAX_ROW_BYTES`. It points at the entry as a whole (the empty JSON Pointer), because what
 * counts is everything stored with it. The Markdown pipeline words its own `size-limit` for
 * `maxMarkdownBytes`, which names the file and the collection's limit.
 *
 * `bytes` is the size in UTF-8 bytes and `limit` the largest size accepted. Call it when `bytes`
 * is over `limit`.
 */
export function sizeLimitViolation(bytes: number, limit: number): Violation {
  return {
    contract: 'size-limit',
    severity: 'error',
    path: '',
    message: `The entry takes ${bytes} bytes and the limit is ${limit} bytes.`,
    fix: `Cut at least ${bytes - limit} bytes: shorten the text, drop what is not essential or split it into several entries.`,
    code: 'size-limit.row',
    params: { bytes, limit },
  }
}
