import type { DescribedSchema } from './types.ts'
import { isRecord, type JsonObject, wrongType } from './values.ts'

const TARGET = 'draft-2020-12'

export function toJsonSchema(schema: DescribedSchema): JsonObject {
  const converted: unknown = schema['~standard'].jsonSchema.input({ target: TARGET })
  if (!isRecord(converted)) {
    throw new TypeError(`the library ${wrongType(converted, 'a JSON Schema object')}`)
  }
  const copy: JsonObject = JSON.parse(JSON.stringify(converted))
  return copy
}

const MAX_REF_HOPS = 16

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

export function describeShape(root: JsonObject, schema: unknown): string {
  const node = resolveSchema(root, schema)
  if (node === null) return 'an unresolvable reference'
  if (node['type'] !== 'array') return typeLabel(node)
  const items = resolveSchema(root, node['items'])
  return `an array of ${items === null ? 'any value' : typeLabel(items)}`
}

export function isStringSchema(root: JsonObject, schema: unknown): boolean {
  return resolveSchema(root, schema)?.['type'] === 'string'
}

export function isStringArraySchema(root: JsonObject, schema: unknown): boolean {
  const node = resolveSchema(root, schema)
  return node?.['type'] === 'array' && isStringSchema(root, node['items'])
}

export function isDateSchema(root: JsonObject, schema: unknown): boolean {
  const node = resolveSchema(root, schema)
  return (
    node?.['type'] === 'string' && (node['format'] === 'date' || node['format'] === 'date-time')
  )
}
