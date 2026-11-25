import type { JSONContent } from '@tiptap/core'
import type { InjectionKey, Ref } from 'vue'
import type { Node as ComarkNode } from 'comark'
import { fieldsOf } from '../frontmatter.ts'
import { toEditor } from './convert.ts'

export interface ComponentDefinition {
  readonly name: string
  readonly description: string | null
  readonly example: string | null
  readonly props: Readonly<Record<string, unknown>> | null
}

export const COMPONENTS_KEY: InjectionKey<Ref<readonly ComponentDefinition[]>> =
  Symbol('components')

export const COMPONENT_CONTENT_KEY: InjectionKey<Ref<Readonly<Record<string, JSONContent>>>> =
  Symbol('component-content')

const KINDS = ['text', 'long', 'date', 'choice', 'number', 'switch', 'image'] as const

export type PropKind = (typeof KINDS)[number] | 'other'
export type PropValue = string | number | boolean | null

export interface PropField {
  readonly name: string
  readonly key: string
  readonly kind: PropKind
  readonly required: boolean
  readonly options: readonly string[]
  readonly maxLength: number | null
  readonly pattern: string | null
  readonly description: string | null
  readonly placeholder: string | null
}

export interface PropForm {
  readonly fields: readonly PropField[]
  readonly values: Record<string, PropValue>
}

export type PropProblem = 'required' | 'pattern' | 'tooLong'

type Props = Record<string, unknown>

const TYPED: ReadonlySet<PropKind> = new Set(['number', 'switch'])

function isRecord(value: unknown): value is Props {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function bare(key: string): string {
  return key.startsWith(':') ? key.slice(1) : key
}

function given(props: unknown): [string, unknown][] {
  return Object.entries(isRecord(props) ? props : {})
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function read(kind: PropKind, options: readonly string[], raw: string): PropValue | undefined {
  switch (kind) {
    case 'number': {
      const number = Number(raw)
      return raw.trim() !== '' && Number.isFinite(number) ? number : undefined
    }
    case 'switch':
      return raw === 'true' ? true : raw === 'false' ? false : undefined
    case 'choice':
      return options.includes(raw) ? raw : undefined
    default:
      return raw
  }
}

export function propForm(props: unknown, schema: unknown): PropForm {
  const values: Record<string, PropValue> = {}
  const fields: PropField[] = []
  const present = new Map(
    given(props).map(([key, value]) => [bare(key), { key, value: textOf(value) }]),
  )
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  const known = new Set<string>()
  for (const field of isRecord(schema) ? fieldsOf(schema) : []) {
    const kind = KINDS.find((one) => one === field.kind)
    if (kind === undefined) continue
    const schemaOf = properties[field.key]
    const definition: Props = isRecord(schemaOf) ? schemaOf : {}
    const found = present.get(field.key)
    const value = found === undefined ? null : read(kind, field.options, found.value)
    if (value === undefined) continue
    known.add(field.key)
    const fallback = definition['default']
    fields.push({
      name: field.key,
      key: found?.key ?? (TYPED.has(kind) ? `:${field.key}` : field.key),
      kind,
      required: field.required,
      options: field.options,
      maxLength: field.maxLength,
      pattern: typeof definition['pattern'] === 'string' ? definition['pattern'] : null,
      description: field.description,
      placeholder: fallback === undefined ? null : textOf(fallback),
    })
    values[field.key] = value
  }
  for (const [name, { key, value }] of present) {
    if (known.has(name)) continue
    const schemaOf = properties[name]
    const definition: Props = isRecord(schemaOf) ? schemaOf : {}
    fields.push({
      name,
      key,
      kind: 'other',
      required: false,
      options: [],
      maxLength: null,
      pattern: null,
      description: typeof definition['description'] === 'string' ? definition['description'] : null,
      placeholder: null,
    })
    values[name] = value
  }
  return { fields, values }
}

function binding(field: PropField, value: PropValue): [string, string] | null {
  if (value === null || value === '') return null
  switch (field.kind) {
    case 'number':
      return [`:${field.name}`, String(value)]
    case 'switch':
      return [`:${field.name}`, value === true ? 'true' : 'false']
    case 'other':
      return [field.key, String(value)]
    default:
      return [field.name, String(value)]
  }
}

export function writeProps(
  props: unknown,
  form: PropForm,
  values: Readonly<Record<string, PropValue>>,
): Record<string, unknown> | null {
  const written: Record<string, unknown> = {}
  const byName = new Map(form.fields.map((field) => [field.name, field]))
  const placed = new Set<string>()
  const place = (field: PropField) => {
    placed.add(field.name)
    const value = values[field.name] ?? null
    const pair = binding(field, value)
    if (pair !== null) written[pair[0]] = pair[1]
  }
  for (const [key, value] of given(props)) {
    const name = bare(key)
    const field = byName.get(name)
    if (field !== undefined && (values[name] ?? null) !== (form.values[name] ?? null)) {
      place(field)
    } else {
      placed.add(name)
      written[key] = value
    }
  }
  for (const field of form.fields) if (!placed.has(field.name)) place(field)
  return Object.keys(written).length === 0 ? null : written
}

function matches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, 'u').test(value)
  } catch {
    return true
  }
}

export function propProblems(
  fields: readonly PropField[],
  values: Readonly<Record<string, PropValue>>,
): Record<string, PropProblem> {
  const problems: Record<string, PropProblem> = {}
  for (const field of fields) {
    const value = values[field.name] ?? null
    if (value === null || value === '') {
      if (field.required) problems[field.name] = 'required'
    } else if (typeof value === 'string' && field.kind !== 'other') {
      if (field.maxLength !== null && value.length > field.maxLength) {
        problems[field.name] = 'tooLong'
      } else if (field.pattern !== null && !matches(field.pattern, value)) {
        problems[field.name] = 'pattern'
      }
    }
  }
  return problems
}

export function componentContent(name: string, example: readonly ComarkNode[]): JSONContent {
  const [first] = toEditor(example).content ?? []
  if (first?.type === 'comarkComponent' && first.attrs?.['name'] === name) return first
  return { type: 'comarkComponent', attrs: { name, props: null }, content: [{ type: 'paragraph' }] }
}

function folded(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function matchingComponents(
  definitions: readonly ComponentDefinition[],
  query: string,
): readonly ComponentDefinition[] {
  const words = folded(query).split(/\s+/).filter(Boolean)
  return definitions.filter((definition) => {
    const text = folded(`${definition.name} ${definition.description ?? ''}`)
    return words.every((word) => text.includes(word))
  })
}
