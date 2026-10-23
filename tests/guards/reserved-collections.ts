import type { TextFile, Violation } from './types.ts'

export interface ReservedCollectionsInput {
  routes: readonly TextFile[]
  reserved: readonly string[]
  reservedFile: string
}

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
