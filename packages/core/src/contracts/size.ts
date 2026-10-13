import type { Violation } from './types.ts'

/**
 * The `size-limit` violation, one for every size limit there is: the Markdown pipeline checks
 * `maxMarkdownBytes` and the store checks the row that D1 holds, and both say it the same way.
 * It points at the entry as a whole (the empty JSON Pointer), because what counts is the whole
 * thing, frontmatter and body.
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
  }
}
