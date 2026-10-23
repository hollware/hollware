import type { StandardSchemaV1 } from '@standard-schema/spec'
import { count, isRecord, type JsonObject, quote } from './text.ts'

const MAX_LISTED_VALUES = 20

export interface FixSubject {
  readonly container: string
  readonly noun: 'field' | 'prop'
}

export function issueSegments(issue: StandardSchemaV1.Issue): string[] {
  return (issue.path ?? []).map((segment) =>
    String(typeof segment === 'object' ? segment.key : segment),
  )
}

export function label(segments: readonly string[]): string {
  return segments.reduce((text, segment) => {
    if (/^\d+$/.test(segment)) return `${text}[${segment}]`
    return text === '' ? segment : `${text}.${segment}`
  }, '')
}

export function fragmentAt(
  schema: JsonObject,
  segments: readonly string[],
): JsonObject | undefined {
  let node = schema
  for (const segment of segments) {
    const properties = node.properties
    if (isRecord(properties) && Object.hasOwn(properties, segment)) {
      const next = properties[segment]
      if (!isRecord(next)) return undefined
      node = next
    } else if (/^\d+$/.test(segment) && isRecord(node.items)) {
      node = node.items
    } else {
      return undefined
    }
  }
  return node
}

function valueAt(input: unknown, segments: readonly string[]): unknown {
  let node = input
  for (const segment of segments) {
    if (Array.isArray(node) && /^\d+$/.test(segment)) node = node[Number(segment)]
    else if (isRecord(node) && Object.hasOwn(node, segment)) node = node[segment]
    else return undefined
  }
  return node
}

function listValues(values: readonly unknown[]): string {
  const shown = values
    .slice(0, MAX_LISTED_VALUES)
    .map((value) => JSON.stringify(value))
    .join(', ')
  const more = values.length - MAX_LISTED_VALUES
  return more > 0 ? `${shown} and ${more} more` : shown
}

function range(min: unknown, max: unknown, noun: string): string | undefined {
  const low = typeof min === 'number' ? min : undefined
  const high = typeof max === 'number' ? max : undefined
  if (low !== undefined && high !== undefined) {
    return low === high ? `exactly ${count(low, noun)}` : `${low} to ${count(high, noun)}`
  }
  if (low !== undefined) return `at least ${count(low, noun)}`
  if (high !== undefined) return `at most ${count(high, noun)}`
  return undefined
}

function stringExpectation(schema: JsonObject): string {
  const length = range(schema.minLength, schema.maxLength, 'character')
  let shape = ''
  if (typeof schema.format === 'string') shape = ` in the format ${JSON.stringify(schema.format)}`
  else if (typeof schema.pattern === 'string') shape = ` matching the pattern ${schema.pattern}`
  return `a string${length === undefined ? '' : ` of ${length}`}${shape}`
}

function numberExpectation(type: 'integer' | 'number', schema: JsonObject): string {
  const bounds = [
    typeof schema.minimum === 'number' ? `at least ${schema.minimum}` : undefined,
    typeof schema.exclusiveMinimum === 'number'
      ? `greater than ${schema.exclusiveMinimum}`
      : undefined,
    typeof schema.maximum === 'number' ? `at most ${schema.maximum}` : undefined,
    typeof schema.exclusiveMaximum === 'number'
      ? `less than ${schema.exclusiveMaximum}`
      : undefined,
  ].filter((bound) => bound !== undefined)
  const base = type === 'integer' ? 'an integer' : 'a number'
  return bounds.length === 0 ? base : `${base} that is ${bounds.join(' and ')}`
}

function arrayExpectation(schema: JsonObject): string {
  const size = range(schema.minItems, schema.maxItems, 'item')
  const items = isRecord(schema.items) ? expectation(schema.items) : undefined
  return `an array${size === undefined ? '' : ` of ${size}`}${items === undefined ? '' : `, each ${items}`}`
}

function objectExpectation(schema: JsonObject): string {
  const keys = isRecord(schema.properties) ? Object.keys(schema.properties) : []
  return keys.length === 0 ? 'an object' : `an object with the keys ${keys.join(', ')}`
}

function typeExpectation(type: unknown, schema: JsonObject): string | undefined {
  switch (type) {
    case 'string':
      return stringExpectation(schema)
    case 'integer':
    case 'number':
      return numberExpectation(type, schema)
    case 'boolean':
      return 'true or false'
    case 'null':
      return 'null'
    case 'array':
      return arrayExpectation(schema)
    case 'object':
      return objectExpectation(schema)
    default:
      return undefined
  }
}

export function expectation(schema: JsonObject): string | undefined {
  if ('const' in schema) return `exactly ${JSON.stringify(schema.const)}`
  if (Array.isArray(schema.enum)) return `one of ${listValues(schema.enum)}`
  const alternatives = schema.anyOf ?? schema.oneOf
  const parts = Array.isArray(alternatives)
    ? alternatives.map((option) => (isRecord(option) ? expectation(option) : undefined))
    : (Array.isArray(schema.type) ? schema.type : [schema.type]).map((type) =>
        typeExpectation(type, schema),
      )
  return parts.every((part) => part !== undefined) ? parts.join(' or ') : undefined
}

function unknownKeys(fragment: JsonObject, value: unknown): string[] {
  const { additionalProperties, properties } = fragment
  if (additionalProperties !== false || !isRecord(properties) || !isRecord(value)) return []
  return Object.keys(value).filter((key) => !Object.hasOwn(properties, key))
}

export interface FixInput {
  readonly subject: FixSubject
  readonly schema: JsonObject | null
  readonly input: unknown
  readonly segments: readonly string[]
  readonly message: string
}

export function fixForIssue({ subject, schema, input, segments, message }: FixInput): string {
  const target =
    segments.length === 0 ? subject.container : `the ${subject.noun} ${quote(label(segments))}`
  const fragment = schema === null ? undefined : fragmentAt(schema, segments)
  if (fragment !== undefined) {
    const unknown = unknownKeys(fragment, valueAt(input, segments))
    if (unknown.length > 0) {
      const allowed = isRecord(fragment.properties) ? Object.keys(fragment.properties) : []
      const nouns = unknown.length === 1 ? subject.noun : `${subject.noun}s`
      const where =
        allowed.length === 0
          ? `no ${subject.noun}s are allowed there`
          : `the ${subject.noun}s allowed there are: ${allowed.join(', ')}`
      return `Remove the ${nouns} ${unknown.map((key) => quote(key)).join(', ')} from ${target}; ${where}.`
    }
  }
  const expected = fragment === undefined ? undefined : expectation(fragment)
  return expected === undefined
    ? `Change ${target} to a value that the schema of ${subject.container} accepts: ${message}`
    : `Set ${target} to ${expected}.`
}
