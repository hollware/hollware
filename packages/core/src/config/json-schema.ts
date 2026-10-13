import type { DescribedSchema } from './types.ts'
import { isRecord, type JsonObject, wrongType } from './values.ts'

/**
 * JSON Schema as the config uses it: what agents see of a schema, and what the checks read of it
 * (which fields exist, of what type, whether an object rejects unknown keys).
 */

/** The dialect agents read. */
const TARGET = 'draft-2020-12'

/**
 * The JSON Schema that a schema accepts as input, as plain JSON data. It throws what the library
 * throws when the schema has no JSON Schema (Zod: `z.date()`, `z.custom()`).
 */
export function toJsonSchema(schema: DescribedSchema): JsonObject {
  const converted: unknown = schema['~standard'].jsonSchema.input({ target: TARGET })
  if (!isRecord(converted)) {
    throw new TypeError(`the library ${wrongType(converted, 'a JSON Schema object')}`)
  }
  // The copy drops what is not JSON (Zod hangs a hidden `~standard` on the result) and gives every
  // caller its own object, so that freezing the description never freezes the library's.
  const copy: JsonObject = JSON.parse(JSON.stringify(converted))
  return copy
}

/** Reference chains longer than this are cycles. */
const MAX_REF_HOPS = 16

/** What a local reference (`#` or `#/$defs/Name`) points to inside `root`, or `undefined`. */
function pointTo(root: JsonObject, ref: string): unknown {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined
  let node: unknown = root
  for (const part of ref.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!isRecord(node) || !Object.hasOwn(node, key)) return undefined
    node = node[key]
  }
  return node
}

/**
 * The schema itself, or the one that its local `$ref`s lead to (Zod writes `$ref` for a schema
 * with an `id`, and for a recursive one); `null` when there is none.
 */
export function resolveSchema(root: JsonObject, schema: unknown): JsonObject | null {
  let node = schema
  for (let hop = 0; hop <= MAX_REF_HOPS; hop += 1) {
    if (!isRecord(node)) return null
    const ref = node['$ref']
    if (typeof ref !== 'string') return node
    node = pointTo(root, ref)
  }
  return null
}

function typeLabel(node: JsonObject): string {
  const type = node['type']
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    const names = type.filter((name): name is string => typeof name === 'string')
    if (names.length > 0) return names.join(' or ')
  }
  return Array.isArray(node['anyOf']) || Array.isArray(node['oneOf']) ? 'a union' : 'any value'
}

/** The type of a schema in words, for a message: `string`, `string or null`, `an array of number`. */
export function describeShape(root: JsonObject, schema: unknown): string {
  const node = resolveSchema(root, schema)
  if (node === null) return 'an unresolvable reference'
  if (node['type'] !== 'array') return typeLabel(node)
  const items = resolveSchema(root, node['items'])
  return `an array of ${items === null ? 'any value' : typeLabel(items)}`
}

/** A string: the value of the field is text. */
export function isStringSchema(root: JsonObject, schema: unknown): boolean {
  return resolveSchema(root, schema)?.['type'] === 'string'
}

/** An array whose items are strings. */
export function isStringArraySchema(root: JsonObject, schema: unknown): boolean {
  const node = resolveSchema(root, schema)
  return node?.['type'] === 'array' && isStringSchema(root, node['items'])
}

/**
 * A string with the format `date` or `date-time`, which is what proves that it is ISO 8601 and
 * sorts by time (Zod: `z.iso.date()` and `z.iso.datetime()`). A string that only has a pattern
 * does not count.
 */
export function isDateSchema(root: JsonObject, schema: unknown): boolean {
  const node = resolveSchema(root, schema)
  return (
    node?.['type'] === 'string' && (node['format'] === 'date' || node['format'] === 'date-time')
  )
}
