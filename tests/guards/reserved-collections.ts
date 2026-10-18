import type { TextFile, Violation } from './types.ts'

/**
 * Guard `reserved-collections`: the read API serves `/v1/<collection>`, so every other route under
 * `/v1/` takes a segment that no collection may be named, or the collection would never be read
 * past it. The names live in `RESERVED_COLLECTION_NAMES` of `packages/core/src/config/constants.ts`.
 */

export interface ReservedCollectionsInput {
  /** The sources of the server's HTTP routes. */
  routes: readonly TextFile[]
  /** `RESERVED_COLLECTION_NAMES`. */
  reserved: readonly string[]
  /** The file that declares them, for the message. */
  reservedFile: string
}

/** The first segments under /v1/ that a source names literally, as `'/v1/site'` or `` `/v1/ops/ ``. */
function segmentsOf(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/['`]\/v1\/([a-z][a-z0-9-]*)(?=[/'`])/g)) {
    if (match[1] !== undefined) found.add(match[1])
  }
  return [...found]
}

export function checkReservedCollections(input: ReservedCollectionsInput): Violation[] {
  const violations: Violation[] = []
  const taken = new Set<string>()
  for (const file of input.routes) {
    for (const segment of segmentsOf(file.text)) {
      taken.add(segment)
      if (!input.reserved.includes(segment)) {
        violations.push({
          rule: 'reserved-collections/unreserved-route',
          file: file.path,
          message: `a route takes /v1/${segment}, which RESERVED_COLLECTION_NAMES does not hold: add "${segment}" to it.`,
        })
      }
    }
  }
  for (const name of input.reserved) {
    if (!taken.has(name)) {
      violations.push({
        rule: 'reserved-collections/no-route',
        file: input.reservedFile,
        message: `RESERVED_COLLECTION_NAMES holds "${name}", which no route under /v1/ takes: remove it.`,
      })
    }
  }
  return violations
}
