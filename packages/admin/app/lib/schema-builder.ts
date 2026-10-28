import type { AutomaticKind } from '@hollware/core'
import type { Messages } from '../i18n/en.ts'

type Json = Record<string, unknown>

export type BuilderKind =
  | 'text'
  | 'date'
  | 'datetime'
  | 'choice'
  | 'list'
  | 'number'
  | 'integer'
  | 'switch'
  | 'image'
  | 'other'

export interface BuilderField {
  key: string
  kind: BuilderKind
  required: boolean
  description: string
  min: number | null
  max: number | null
  options: string[]
  readonly original: Json
  readonly originalKind: BuilderKind | null
}

export interface BuilderSchema {
  fields: BuilderField[]
  readonly rest: Json
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function kindOf(schema: Json): BuilderKind {
  if (Array.isArray(schema['enum']) && schema['enum'].every((value) => typeof value === 'string')) {
    return 'choice'
  }
  switch (schema['type']) {
    case 'string':
      if (schema['format'] === 'date') return 'date'
      if (schema['format'] === 'date-time') return 'datetime'
      if (typeof schema['pattern'] === 'string' && schema['pattern'].startsWith('^asset:')) {
        return 'image'
      }
      return 'text'
    case 'number':
      return 'number'
    case 'integer':
      return 'integer'
    case 'boolean':
      return 'switch'
    case 'array':
      return isRecord(schema['items']) && schema['items']['type'] === 'string' ? 'list' : 'other'
    default:
      return 'other'
  }
}

function boundsOf(kind: BuilderKind): readonly [string, string] | null {
  switch (kind) {
    case 'text':
      return ['minLength', 'maxLength']
    case 'list':
      return ['minItems', 'maxItems']
    case 'number':
    case 'integer':
      return ['minimum', 'maximum']
    default:
      return null
  }
}

export function fieldsFromSchema(schema: Json): BuilderSchema {
  const { properties, required, ...rest } = schema
  const names = new Set(
    Array.isArray(required) ? required.filter((name) => typeof name === 'string') : [],
  )
  const fields = Object.entries(isRecord(properties) ? properties : {}).map(([key, value]) => {
    const original = isRecord(value) ? value : {}
    const kind = kindOf(original)
    const bounds = boundsOf(kind)
    return {
      key,
      kind,
      required: names.has(key),
      description: typeof original['description'] === 'string' ? original['description'] : '',
      min: bounds === null ? null : numberOr(original[bounds[0]]),
      max: bounds === null ? null : numberOr(original[bounds[1]]),
      options: Array.isArray(original['enum']) ? original['enum'].map(String) : [],
      original,
      originalKind: kind,
    }
  })
  return { fields, rest }
}

function freshSchema(kind: BuilderKind): Json {
  switch (kind) {
    case 'text':
      return { type: 'string' }
    case 'date':
      return { type: 'string', format: 'date' }
    case 'datetime':
      return { type: 'string', format: 'date-time' }
    case 'choice':
      return { type: 'string', enum: [] }
    case 'list':
      return { type: 'array', items: { type: 'string' } }
    case 'number':
      return { type: 'number' }
    case 'integer':
      return { type: 'integer' }
    case 'switch':
      return { type: 'boolean' }
    case 'image':
      return { type: 'string', pattern: '^asset:ast_[0-9a-f]{26}$' }
    case 'other':
      return {}
  }
}

function schemaOf(field: BuilderField): Json {
  const schema: Json =
    field.originalKind === field.kind ? { ...field.original } : freshSchema(field.kind)
  if (field.description.trim() === '') delete schema['description']
  else schema['description'] = field.description
  const bounds = boundsOf(field.kind)
  if (bounds !== null) {
    for (const [keyword, value] of [
      [bounds[0], field.min],
      [bounds[1], field.max],
    ] as const) {
      if (value === null) delete schema[keyword]
      else schema[keyword] = value
    }
  }
  if (field.kind === 'choice') schema['enum'] = [...field.options]
  return schema
}

export function schemaFromFields(builder: BuilderSchema): Json {
  const required = builder.fields.filter((field) => field.required).map((field) => field.key)
  return {
    ...builder.rest,
    type: 'object',
    properties: Object.fromEntries(builder.fields.map((field) => [field.key, schemaOf(field)])),
    ...(required.length === 0 ? {} : { required }),
  }
}

export function newField(key: string, kind: BuilderKind): BuilderField {
  return {
    key,
    kind,
    required: false,
    description: '',
    min: null,
    max: null,
    options: [],
    original: freshSchema(kind),
    originalKind: kind,
  }
}

export function problemsOf(
  fields: readonly BuilderField[],
  text: Messages['collection']['problems'],
): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const field of fields) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.key)) {
      problems.push(text.notName(field.key))
    }
    if (seen.has(field.key)) problems.push(text.twice(field.key))
    seen.add(field.key)
    if (field.min !== null && field.max !== null && field.min > field.max) {
      problems.push(text.bounds(field.key))
    }
    if (field.kind === 'choice' && field.options.length === 0) {
      problems.push(text.choice(field.key))
    }
  }
  return problems
}

export function automaticChoices(kind: BuilderKind): readonly AutomaticKind[] {
  switch (kind) {
    case 'date':
    case 'datetime':
      return ['firstPublished', 'lastModified']
    case 'number':
    case 'integer':
      return ['readingTime', 'wordCount']
    default:
      return []
  }
}

export function automaticOf(
  fields: readonly BuilderField[],
  automatic: Readonly<Record<string, AutomaticKind>>,
): Record<string, AutomaticKind> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const kind = automatic[field.key]
      return kind !== undefined && automaticChoices(field.kind).includes(kind)
        ? [[field.key, kind]]
        : []
    }),
  )
}
