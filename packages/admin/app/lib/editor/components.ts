import type { JSONContent } from '@tiptap/core'
import type { InjectionKey, Ref } from 'vue'
import type { Node as ComarkNode } from 'comark'
import { toEditor } from './convert.ts'

export interface ComponentDefinition {
  readonly name: string
  readonly description: string | null
  readonly example: string | null
  readonly props: Readonly<Record<string, unknown>> | null
}

export interface PropEntry {
  readonly key: string
  readonly label: string
  readonly description: string | null
  value: string
}

export const COMPONENTS_KEY: InjectionKey<Ref<readonly ComponentDefinition[]>> =
  Symbol('components')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typed(schema: unknown): boolean {
  if (!isRecord(schema)) return false
  const type = schema['type']
  return type === 'number' || type === 'integer' || type === 'boolean'
}

export function propEntries(given: unknown, schema: unknown): PropEntry[] {
  const props = isRecord(given) ? given : {}
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  const entries: PropEntry[] = []
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(props)) {
    const label = key.replace(/^:/, '')
    seen.add(label)
    const definition = properties[label]
    entries.push({
      key,
      label,
      description:
        isRecord(definition) && typeof definition['description'] === 'string'
          ? definition['description']
          : null,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })
  }
  for (const [label, definition] of Object.entries(properties)) {
    if (seen.has(label)) continue
    entries.push({
      key: typed(definition) ? `:${label}` : label,
      label,
      description:
        isRecord(definition) && typeof definition['description'] === 'string'
          ? definition['description']
          : null,
      value: '',
    })
  }
  return entries
}

export function propsFrom(entries: readonly PropEntry[]): Record<string, string> | null {
  const props: Record<string, string> = {}
  for (const entry of entries) if (entry.value.trim() !== '') props[entry.key] = entry.value
  return Object.keys(props).length === 0 ? null : props
}

export function componentContent(name: string, example: readonly ComarkNode[]): JSONContent {
  const [first] = toEditor(example).content ?? []
  if (first?.type === 'comarkComponent' && first.attrs?.['name'] === name) return first
  return { type: 'comarkComponent', attrs: { name, props: null }, content: [{ type: 'paragraph' }] }
}
