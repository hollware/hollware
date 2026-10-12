import { OPERATIONS, type Operation, type Scope } from '@hollware/core'
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'

type Converter = StandardSchemaWithJSON['~standard']['jsonSchema']
type ConverterOptions = Parameters<Converter['input']>[0]

/**
 * `schema` with the same validation, whose conversions to JSON Schema are done once and kept.
 * The SDK builds a server for every request, and a server converts the schemas of its tools on
 * its own, so without this every `tools/list` pays for the conversion again (about 1.4 ms for
 * the nine operations, measured in the v0.1 spike). Zod stays the only definition: it validates,
 * applies the defaults and words the errors; only the JSON Schema is cached.
 *
 * What the cache returns is shared by every request: the SDK reads it and never changes it.
 */
export function memoizeJsonSchema(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  const standard = schema['~standard']
  const cache = new Map<string, Record<string, unknown>>()
  const convert = (io: 'input' | 'output') => (options: ConverterOptions) => {
    // Library options can change the result, and the cache is keyed by the target alone.
    if (options.libraryOptions !== undefined) return standard.jsonSchema[io](options)
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

/** One tool: the spec of an operation, the schemas the SDK gets for it and the scopes it needs. */
export interface Tool {
  readonly spec: Operation
  readonly input: StandardSchemaWithJSON
  readonly output: StandardSchemaWithJSON
  /** Every scope the caller needs, at least one. */
  readonly scopes: readonly [Scope, ...Scope[]]
}

const byName = (a: Operation, b: Operation) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

/**
 * The tools of `operations`, sorted by name. The SDK lists tools in the order they are
 * registered, and `tools/list` must be the same for every client and every call, so the order
 * is decided here, by code unit and never by locale. The schemas of each tool are cached.
 *
 * An operation that asks for no scope is refused: a tool that anyone may call has to be a
 * decision someone makes, not a spec that forgot its scopes.
 */
export function createToolTable(operations: readonly Operation[] = OPERATIONS): readonly Tool[] {
  return operations.toSorted(byName).map((spec) => {
    const [first, ...rest] = spec.scopes
    if (first === undefined) {
      throw new Error(`${spec.name} asks for no scope; every tool needs at least one`)
    }
    return {
      spec,
      input: memoizeJsonSchema(spec.input),
      output: memoizeJsonSchema(spec.output),
      scopes: [first, ...rest],
    }
  })
}
