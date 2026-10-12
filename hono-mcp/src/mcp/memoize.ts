import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'

// The third option between "Zod every request" and "precomputed JSON Schema": keep Zod as the one
// definition (validation, defaults, messages) but convert it to JSON Schema once per isolate.
// The SDK builds a fresh McpServer per request, so its own per-instance memo never helps.

type Converter = StandardSchemaWithJSON['~standard']['jsonSchema']
type ConverterOptions = Parameters<Converter['input']>[0]

/** Same validation as `schema`; `jsonSchema.input/output` computed on first use, then reused. */
export function memoizeJsonSchema<Input, Output>(
  schema: StandardSchemaWithJSON<Input, Output>,
): StandardSchemaWithJSON<Input, Output> {
  const standard = schema['~standard']
  const cache = new Map<string, Record<string, unknown>>()
  const convert = (io: 'input' | 'output') => (options: ConverterOptions) => {
    const key = `${io}:${options.target}`
    let json = cache.get(key)
    if (json === undefined) {
      json = standard.jsonSchema[io](options)
      cache.set(key, json)
    }
    return json
  }
  return {
    '~standard': {
      version: standard.version,
      vendor: standard.vendor,
      types: standard.types,
      validate: (value, options) => standard.validate(value, options),
      jsonSchema: { input: convert('input'), output: convert('output') },
    },
  }
}

type InputOf<S> = S extends StandardSchemaWithJSON<infer Input, unknown> ? Input : never
type OutputOf<S> = S extends StandardSchemaWithJSON<unknown, infer Output> ? Output : never

export type Memoized<T extends Record<string, StandardSchemaWithJSON>> = {
  [K in keyof T]: StandardSchemaWithJSON<InputOf<T[K]>, OutputOf<T[K]>>
}

export function memoizeSchemas<T extends Record<string, StandardSchemaWithJSON>>(
  schemas: T,
): Memoized<T> {
  const entries = Object.entries(schemas).map(([key, schema]) => [key, memoizeJsonSchema(schema)])
  // Object.fromEntries erases the key types; the mapped type restores them.
  return Object.fromEntries(entries) as Memoized<T>
}
