import { Validator, type OutputUnit } from '@cfworker/json-schema'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { DescribedSchema } from '../config/types.ts'

/**
 * A JSON Schema stored in D1 (ADR-033) as the schema of a collection or of a component's props:
 * validated by `@cfworker/json-schema`, which runs in Workers without `eval`, and seen by the
 * rest of Hollware as any Standard Schema, so that the schema contract, its fixes and
 * `describe_site` treat it as they treat a Zod schema. It accepts the value as it is: a JSON
 * Schema returns no other value than the one it checked.
 */

type JsonObject = Record<string, unknown>

/** The keywords that only say that a part below them failed; that part says what. */
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

/** `#/tags/0` as the path of an issue: `['tags', '0']`. */
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

/** The schema of the object at `segments`, to tell a declared key from an unknown one. */
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

/** The issues of a validation: one for each part that failed, at the path of the value. */
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
      // A key that no schema allows. A declared key that failed is reported by its own keyword,
      // and @cfworker/json-schema also marks it as not allowed: that one is left out.
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
