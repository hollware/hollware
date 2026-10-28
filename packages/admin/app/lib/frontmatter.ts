import { parseDocument, stringify } from 'yaml'

type JsonSchema = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type FieldKind = 'text' | 'long' | 'date' | 'choice' | 'list' | 'number' | 'switch' | 'image'

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
        if (typeof value['pattern'] === 'string' && value['pattern'].startsWith('^asset:')) {
          return [{ ...base, kind: 'image' }]
        }
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

export interface Reference {
  readonly collection: string
  readonly locale: string
}

export function referencesOf(
  rules: readonly { readonly rule: string; readonly params: Readonly<Record<string, unknown>> }[],
  locale: string,
): Record<string, Reference> {
  return Object.fromEntries(
    rules.flatMap((use) => {
      const { field, collection } = use.params
      const named = use.params['locale']
      return use.rule === 'reference' && typeof field === 'string' && typeof collection === 'string'
        ? [[field, { collection, locale: typeof named === 'string' ? named : locale }]]
        : []
    }),
  )
}

export function markdownOnly(schema: JsonSchema): string[] {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {}
  const shown = new Set(fieldsOf(schema).map((field) => field.key))
  return Object.entries(properties)
    .filter(([key, value]) => !shown.has(key) && !(isRecord(value) && value['readOnly'] === true))
    .map(([key]) => key)
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

export function setField(markdown: string, key: string, value: unknown): string {
  const block = FENCE.exec(markdown)
  if (block === null) {
    if (value === undefined) return markdown
    const yaml = stringify({ [key]: value }, { lineWidth: 0 }).trimEnd()
    return `---\n${yaml}\n---\n\n${markdown}`
  }
  const document = parseDocument(block[1] ?? '')
  if (document.errors.length > 0) return markdown
  if (value === undefined) document.delete(key)
  else document.set(key, value)
  const yaml = document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()
  return `---\n${yaml}\n---${block[2] ?? '\n'}${markdown.slice(block[0].length)}`
}

export function bodyOf(markdown: string): string {
  const block = FENCE.exec(markdown)
  return block === null ? markdown : markdown.slice(block[0].length).replace(/^\r?\n/, '')
}

export function withBody(markdown: string, body: string): string {
  const block = FENCE.exec(markdown)
  if (block === null) return body
  const fence = block[0].endsWith('\n') ? block[0] : `${block[0]}\n`
  return `${fence}\n${body}`
}
