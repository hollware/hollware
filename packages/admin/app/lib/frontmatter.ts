import { parseDocument, stringify } from 'yaml'

type JsonSchema = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type FieldKind = 'text' | 'long' | 'date' | 'choice' | 'list' | 'number' | 'switch'

export interface Field {
  readonly key: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly options: readonly string[]
  readonly maxLength: number | null
  readonly description: string | null
}

const LONG_TEXT = 120

export function fieldsOf(schema: JsonSchema): Field[] {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {}
  const required = new Set(
    Array.isArray(schema['required'])
      ? schema['required'].filter((name): name is string => typeof name === 'string')
      : [],
  )
  return Object.entries(properties).flatMap(([key, value]): Field[] => {
    if (!isRecord(value) || value['readOnly'] === true) return []
    const maxLength = typeof value['maxLength'] === 'number' ? value['maxLength'] : null
    const base = {
      key,
      required: required.has(key),
      options: [] as string[],
      maxLength,
      description: typeof value['description'] === 'string' ? value['description'] : null,
    }
    if (Array.isArray(value['enum'])) {
      return [{ ...base, kind: 'choice', options: value['enum'].map(String) }]
    }
    switch (value['type']) {
      case 'string':
        if (value['format'] === 'date') return [{ ...base, kind: 'date' }]
        return [{ ...base, kind: maxLength !== null && maxLength > LONG_TEXT ? 'long' : 'text' }]
      case 'number':
      case 'integer':
        return [{ ...base, kind: 'number' }]
      case 'boolean':
        return [{ ...base, kind: 'switch' }]
      case 'array': {
        const items = isRecord(value['items']) ? value['items'] : {}
        return items['type'] === 'string' ? [{ ...base, kind: 'list' }] : []
      }
      default:
        return []
    }
  })
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/

export function readFrontmatter(markdown: string): Record<string, unknown> | null {
  const block = FENCE.exec(markdown)
  if (block === null) return null
  const document = parseDocument(block[1] ?? '')
  if (document.errors.length > 0) return null
  const values: unknown = document.toJS()
  return isRecord(values) ? { ...values } : {}
}

export function writeFrontmatter(
  markdown: string,
  values: Readonly<Record<string, unknown>>,
): string {
  const yaml = stringify(values, { lineWidth: 0 }).trimEnd()
  const block = FENCE.exec(markdown)
  if (block === null) return `---\n${yaml}\n---\n\n${markdown}`
  return `---\n${yaml}\n---${block[2] ?? '\n'}${markdown.slice(block[0].length)}`
}
