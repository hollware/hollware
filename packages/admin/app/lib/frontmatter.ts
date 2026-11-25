import { Document, isMap, isSeq, parseDocument } from 'yaml'

type JsonSchema = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type FieldKind =
  | 'text'
  | 'long'
  | 'date'
  | 'choice'
  | 'choices'
  | 'list'
  | 'number'
  | 'switch'
  | 'image'
  | 'object'
  | 'objects'

export interface Field {
  readonly key: string
  readonly kind: FieldKind
  readonly required: boolean
  readonly options: readonly string[]
  readonly maxLength: number | null
  readonly description: string | null
  readonly fields: readonly Field[]
}

export type Path = readonly (string | number)[]

const LONG_TEXT = 120
const DEEPEST = 4

export function fieldsOf(schema: JsonSchema, depth = 0): Field[] {
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
      fields: [] as Field[],
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
      case 'object': {
        const fields = depth < DEEPEST ? fieldsOf(value, depth + 1) : []
        return fields.length > 0 ? [{ ...base, kind: 'object', fields }] : []
      }
      case 'array': {
        const items = isRecord(value['items']) ? value['items'] : {}
        if (Array.isArray(items['enum'])) {
          return [{ ...base, kind: 'choices', options: items['enum'].map(String) }]
        }
        if (items['type'] === 'string') return [{ ...base, kind: 'list' }]
        const fields =
          items['type'] === 'object' && depth < DEEPEST ? fieldsOf(items, depth + 1) : []
        return fields.length > 0 ? [{ ...base, kind: 'objects', fields }] : []
      }
      default:
        return []
    }
  })
}

export function valueAt(values: unknown, path: Path): unknown {
  let current = values
  for (const step of path) {
    if (typeof step === 'number' ? !Array.isArray(current) : !isRecord(current)) return undefined
    current = (current as Readonly<Record<string | number, unknown>>)[step]
  }
  return current
}

function emptyOf(field: Field): unknown {
  switch (field.kind) {
    case 'choice':
      return field.options[0] ?? ''
    case 'number':
      return 0
    case 'switch':
      return false
    case 'list':
    case 'choices':
    case 'objects':
      return []
    case 'object':
      return newItem(field.fields)
    default:
      return ''
  }
}

export function newItem(fields: readonly Field[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => field.required).map((field) => [field.key, emptyOf(field)]),
  )
}

export function itemTitle(item: unknown, fields: readonly Field[]): string | null {
  for (const field of fields) {
    if (field.kind !== 'text') continue
    const value = valueAt(item, [field.key])
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

export interface FlatValue {
  readonly path: readonly string[]
  readonly text: string
}

export function flatValues(value: unknown, path: readonly string[] = []): FlatValue[] {
  if (Array.isArray(value)) {
    if (value.every((item) => !isRecord(item) && !Array.isArray(item))) {
      return [{ path, text: value.map(String).join(', ') }]
    }
    return value.flatMap((item, index) => flatValues(item, [...path, String(index + 1)]))
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, inner]) => flatValues(inner, [...path, key]))
  }
  const text =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''
  return [{ path, text }]
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

function editFrontmatter(markdown: string, change: (document: Document) => void): string {
  const block = FENCE.exec(markdown)
  if (block === null) {
    const document = new Document({})
    change(document)
    const yaml = document.toString({ lineWidth: 0 }).trimEnd()
    return yaml === '{}' ? markdown : `---\n${yaml}\n---\n\n${markdown}`
  }
  const document = parseDocument(block[1] ?? '')
  if (document.errors.length > 0) return markdown
  change(document)
  const yaml = document.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()
  return `---\n${yaml}\n---${block[2] ?? '\n'}${markdown.slice(block[0].length)}`
}

function unfoldEmpty(document: Document, path: Path) {
  const node = path.length === 0 ? document.contents : document.getIn(path, true)
  if ((isMap(node) || isSeq(node)) && node.flow === true && node.items.length === 0) {
    node.flow = false
  }
}

export function setField(markdown: string, key: string | Path, value: unknown): string {
  const path = typeof key === 'string' ? [key] : key
  return editFrontmatter(markdown, (document) => {
    if (value === undefined) {
      document.deleteIn(path)
      return
    }
    unfoldEmpty(document, path.slice(0, -1))
    document.setIn(path, value)
  })
}

export function addItem(markdown: string, path: Path, item: unknown): string {
  return editFrontmatter(markdown, (document) => {
    const list = document.getIn(path, true)
    if (!isSeq(list)) {
      unfoldEmpty(document, path.slice(0, -1))
      document.setIn(path, document.createNode([item]))
      return
    }
    unfoldEmpty(document, path)
    list.items.push(document.createNode(item))
  })
}

export function removeItem(markdown: string, path: Path, index: number): string {
  return editFrontmatter(markdown, (document) => {
    const list = document.getIn(path, true)
    if (isSeq(list) && index >= 0 && index < list.items.length) list.items.splice(index, 1)
  })
}

export function moveItem(markdown: string, path: Path, from: number, to: number): string {
  return editFrontmatter(markdown, (document) => {
    const list = document.getIn(path, true)
    if (!isSeq(list) || to < 0 || to >= list.items.length || from === to) return
    const [moved] = list.items.splice(from, 1)
    if (moved !== undefined) list.items.splice(to, 0, moved)
  })
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
