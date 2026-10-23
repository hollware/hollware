import { Validator, type OutputUnit } from '@cfworker/json-schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { DescribedSchema } from '../config/types.ts'

type JsonObject = Record<string, unknown>

const SUMMARIES: ReadonlySet<string> = new Set([
  'properties',
  'items',
  'prefixItems',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'allOf',
  'patternProperties',
  'contains',
  'dependentSchemas',
  '$ref',
])

function segmentsOf(location: string): string[] {
  return location
    .replace(/^#\/?/, '')
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => decodeURIComponent(segment).replaceAll('~1', '/').replaceAll('~0', '~'))
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function declaredKeys(schema: JsonObject, segments: readonly string[]): ReadonlySet<string> {
  let node: unknown = schema
  for (const segment of segments) {
    if (!isRecord(node)) return new Set()
    const properties = node['properties']
    node =
      isRecord(properties) && Object.hasOwn(properties, segment)
        ? properties[segment]
        : node['items']
  }
  const properties = isRecord(node) ? node['properties'] : undefined
  return new Set(isRecord(properties) ? Object.keys(properties) : [])
}

export function issuesOf(
  schema: JsonObject,
  errors: readonly OutputUnit[],
): StandardSchemaV1.Issue[] {
  const issues: StandardSchemaV1.Issue[] = []
  for (const error of errors) {
    if (SUMMARIES.has(error.keyword)) continue
    const path = segmentsOf(error.instanceLocation)
    if (error.keyword === 'required') {
      const missing = /required property "(.*)"/.exec(error.error)?.[1]
      issues.push({
        message: missing === undefined ? error.error : `Missing required field "${missing}".`,
        path: missing === undefined ? path : [...path, missing],
      })
      continue
    }
    if (error.keyword === 'false') {
      const key = path.at(-1)
      if (key === undefined || declaredKeys(schema, path.slice(0, -1)).has(key)) continue
      issues.push({ message: `Unrecognized key "${key}".`, path })
      continue
    }
    issues.push({ message: error.error, path })
  }
  return issues
}

/** A JSON Schema (draft 2020-12) as a schema of Hollware. */
export function describedSchemaOf(schema: JsonObject): DescribedSchema {
  const validator = new Validator(
    schema as ConstructorParameters<typeof Validator>[0],
    '2020-12',
    false,
  )
  return {
    '~standard': {
      version: 1,
      vendor: 'hollware-json-schema',
      validate: (value) => {
        const result = validator.validate(value)
        return result.valid ? { value } : { issues: issuesOf(schema, result.errors) }
      },
      jsonSchema: {
        input: () => schema,
        output: () => schema,
      },
    },
  }
}
