/**
 * The parameters of a rule of the catalog as form inputs, from the JSON Schema the catalog gives
 * for them (ADR-033): a field of the frontmatter (picked from the collection's), a list of
 * fields, a text, a number or a list of texts.
 */

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

/** The parameters that name fields of the frontmatter, as the catalog calls them. */
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

/** The parameters with what the person left empty taken out, as the server expects them. */
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
