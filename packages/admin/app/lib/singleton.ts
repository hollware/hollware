import type { Api } from './api.ts'
import { entryPath } from './entries.ts'

export interface SingletonCollection {
  readonly name: string
  readonly schema: Readonly<Record<string, unknown>>
  readonly routes: Readonly<Record<string, string>>
  readonly translationGroupField: string | null
  readonly singleton?: boolean
}

export type CollectionKind = 'list' | 'page' | 'settings'

export function kindOf(collection: {
  readonly singleton?: boolean
  readonly routes: Readonly<Record<string, string>>
}): CollectionKind {
  if (collection.singleton !== true) return 'list'
  return Object.keys(collection.routes).length === 0 ? 'settings' : 'page'
}

export const KIND_ICON = {
  list: 'i-lucide-layers',
  page: 'i-lucide-file',
  settings: 'i-lucide-sliders-horizontal',
} as const satisfies Record<CollectionKind, string>

export type Opening =
  | { readonly kind: 'open'; readonly to: string }
  | { readonly kind: 'trash' }
  | {
      readonly kind: 'new'
      readonly query: Readonly<Record<string, string>>
    }

export function humanName(name: string): string {
  const words = name.replace(/-/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

export async function openSingleton(
  api: Pick<Api, 'call'>,
  collection: SingletonCollection,
  locale: string,
): Promise<Opening> {
  const here = await api.call('list_entries', { collection: collection.name, locale, limit: 1 })
  const found = here.entries[0]
  if (found !== undefined) return { kind: 'open', to: entryPath(found) }
  const trashed = await api.call('list_entries', {
    collection: collection.name,
    locale,
    trashed: true,
    limit: 1,
  })
  if (trashed.entries[0] !== undefined) return { kind: 'trash' }
  const anywhere = await api.call('list_entries', { collection: collection.name, limit: 1 })
  const group = anywhere.entries[0]?.translationGroup ?? null
  return {
    kind: 'new',
    query: {
      collection: collection.name,
      locale,
      ...(group === null ? {} : { group }),
    },
  }
}
