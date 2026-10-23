type Json = Record<string, unknown>

export type ParamKind = 'field' | 'fields' | 'text' | 'number' | 'texts'

export interface ParamInput {
  readonly key: string
  readonly kind: ParamKind
  readonly required: boolean
  readonly description: string | null
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const FIELD_PARAMS: ReadonlySet<string> = new Set(['field', 'unless'])
const FIELDS_PARAMS: ReadonlySet<string> = new Set(['fields'])

export function paramInputs(schema: Json): ParamInput[] {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {}
  const required = new Set(Array.isArray(schema['required']) ? schema['required'].map(String) : [])
  return Object.entries(properties).map(([key, value]) => {
    const property = isRecord(value) ? value : {}
    const description = typeof property['description'] === 'string' ? property['description'] : null
    const type = property['type']
    const kind: ParamKind =
      type === 'integer' || type === 'number'
        ? 'number'
        : type === 'array'
          ? FIELDS_PARAMS.has(key)
            ? 'fields'
            : 'texts'
          : FIELD_PARAMS.has(key)
            ? 'field'
            : 'text'
    return { key, kind, required: required.has(key), description }
  })
}

export function cleanParams(params: Readonly<Json>): Json {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0),
    ),
  )
}
