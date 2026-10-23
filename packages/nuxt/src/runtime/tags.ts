import { entryTag, EVERY_LOCALE, groupTag, listTag, SITE_TAG } from '@hollware/core'

const KEY = 'hollwareTags'

interface Tagged {
  readonly context: Record<string, unknown>
}

export function recordTags(event: Tagged | undefined, tags: readonly string[]): void {
  if (event === undefined || tags.length === 0) return
  const found: unknown = event.context[KEY]
  const set = found instanceof Set ? found : new Set<string>()
  for (const tag of tags) set.add(tag)
  event.context[KEY] = set
}

export function tagsOf(event: Tagged): string[] {
  const found: unknown = event.context[KEY]
  return found instanceof Set ? [...found].map(String) : []
}

interface Entryish {
  readonly id?: unknown
}

function idsOf(entries: readonly Entryish[]): string[] {
  return entries.flatMap((entry) => (typeof entry.id === 'string' ? [entryTag(entry.id)] : []))
}

export function entryTags(entry: Entryish | undefined): string[] {
  return entry === undefined ? [] : idsOf([entry])
}

export function listTags(
  collection: string,
  locale: string | undefined,
  entries: readonly Entryish[],
): string[] {
  return [listTag(collection, locale ?? EVERY_LOCALE), ...idsOf(entries)]
}

export function groupTags(
  collection: string,
  group: string,
  entries: readonly Entryish[],
): string[] {
  return [groupTag(collection, group), ...idsOf(entries)]
}

export function siteTags(): string[] {
  return [SITE_TAG]
}

export const EDGE_SECONDS = 31_536_000

export function edgeHeaders(
  tags: readonly string[],
  status: number,
  method: string,
): Readonly<Record<string, string>> | null {
  if (tags.length === 0 || status !== 200 || method !== 'GET') return null
  return {
    'cache-tag': tags.join(','),
    'cache-control': 'public, max-age=0, must-revalidate',
    'cloudflare-cdn-cache-control': `max-age=${EDGE_SECONDS}`,
  }
}

export const PREVIEW_HEADER = 'x-hollware-preview'
