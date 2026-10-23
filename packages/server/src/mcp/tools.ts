import { OPERATIONS, type Operation, type Scope } from '@hollware/core'
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server'

type Converter = StandardSchemaWithJSON['~standard']['jsonSchema']
type ConverterOptions = Parameters<Converter['input']>[0]

export function memoizeJsonSchema(schema: StandardSchemaWithJSON): StandardSchemaWithJSON {
  const standard = schema['~standard']
  const cache = new Map<string, Record<string, unknown>>()
  const convert = (io: 'input' | 'output') => (options: ConverterOptions) => {
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

export interface Tool {
  readonly spec: Operation
  readonly input: StandardSchemaWithJSON
  readonly output: StandardSchemaWithJSON
  readonly scopes: readonly [Scope, ...Scope[]]
}

const byName = (a: Operation, b: Operation) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

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
