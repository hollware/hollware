import {
  EVENT_ID_HEADER,
  hollwareEvent,
  OPERATIONS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@hollware/core'
import * as z from 'zod'
import readApi from '../../../../api/http.json'

export const WEBHOOK_HEADERS = {
  event: EVENT_ID_HEADER,
  timestamp: TIMESTAMP_HEADER,
  signature: SIGNATURE_HEADER,
} as const

export interface Parameter {
  readonly name: string
  readonly in: string
  readonly required: boolean
  readonly description: string | null
}

export interface Endpoint {
  readonly method: string
  readonly path: string
  readonly operation: string
  readonly answers: string
  readonly description: string
  readonly statuses: readonly string[]
  readonly parameters: readonly Parameter[]
}

interface OpenApiParameter {
  readonly in: string
  readonly name: string
  readonly required?: boolean
}

interface OpenApiOperation {
  readonly operationId: string
  readonly parameters?: readonly OpenApiParameter[]
  readonly responses: Readonly<Record<string, { readonly description?: string }>>
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function descriptionsOf(operation: string): Json {
  const spec = OPERATIONS.find((candidate) => candidate.name === operation)
  if (spec === undefined) return {}
  const schema: unknown = z.toJSONSchema(spec.input, { io: 'input' })
  return isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
}

export function readApiEndpoints(): Endpoint[] {
  const paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>> = readApi.paths
  return Object.entries(paths)
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, operation]) => {
        const properties = descriptionsOf(operation.operationId)
        const spec = OPERATIONS.find((candidate) => candidate.name === operation.operationId)
        return {
          method: method.toUpperCase(),
          path,
          operation: operation.operationId,
          answers: operation.responses['200']?.description ?? '',
          description: spec?.description ?? '',
          statuses: Object.keys(operation.responses),
          parameters: (operation.parameters ?? []).map((parameter) => {
            const found = properties[parameter.name]
            return {
              name: parameter.name,
              in: parameter.in,
              required: parameter.required === true,
              description:
                isRecord(found) && typeof found['description'] === 'string'
                  ? found['description']
                  : null,
            }
          }),
        }
      }),
    )
    .sort((a, b) => a.path.localeCompare(b.path))
}

export interface EventField {
  readonly name: string
  readonly type: string
  readonly description: string | null
}

export interface EventKind {
  readonly kinds: readonly string[]
  readonly description: string | null
  readonly fields: readonly EventField[]
}

function typeOf(schema: unknown): string {
  if (!isRecord(schema)) return 'unknown'
  if (Array.isArray(schema['anyOf'])) return schema['anyOf'].map(typeOf).join(' | ')
  if (Array.isArray(schema['enum']))
    return schema['enum'].map((value) => JSON.stringify(value)).join(' | ')
  if ('const' in schema) return JSON.stringify(schema['const'])
  if (schema['type'] === 'array') return `${typeOf(schema['items'])}[]`
  if (schema['type'] === 'object') return 'object'
  return typeof schema['type'] === 'string' ? schema['type'] : 'unknown'
}

export function eventKinds(): EventKind[] {
  const schema: unknown = z.toJSONSchema(hollwareEvent, { io: 'output' })
  const variants = isRecord(schema) && Array.isArray(schema['oneOf']) ? schema['oneOf'] : []
  return variants.filter(isRecord).map((variant) => {
    const properties = isRecord(variant['properties']) ? variant['properties'] : {}
    const kind = properties['kind']
    const kinds =
      isRecord(kind) && Array.isArray(kind['enum'])
        ? kind['enum'].map(String)
        : isRecord(kind) && 'const' in kind
          ? [String(kind['const'])]
          : []
    return {
      kinds,
      description: typeof variant['description'] === 'string' ? variant['description'] : null,
      fields: Object.entries(properties)
        .filter(([name]) => name !== 'kind')
        .map(([name, field]) => ({
          name,
          type: typeOf(field),
          description:
            isRecord(field) && typeof field['description'] === 'string'
              ? field['description']
              : null,
        })),
    }
  })
}
