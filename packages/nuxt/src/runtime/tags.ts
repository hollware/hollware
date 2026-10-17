import { entryTag, EVERY_LOCALE, groupTag, listTag, SITE_TAG } from '@hollware/core'

/**
 * The cache tags of a response (S8): what it showed of Hollware, in the names of the contract of
 * `@hollware/core`, gathered on its request as each read answers, and written as `Cache-Tag` once
 * it is rendered. A page gathers the tags of every read it made; a route of `/_hollware/` those of
 * its own.
 */

const KEY = 'hollwareTags'

/** What a request holds of its own, whether Nuxt's or h3's: its context. */
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

/** The tags of an entry read alone. */
export function entryTags(entry: Entryish | undefined): string[] {
  return entry === undefined ? [] : idsOf([entry])
}

/** The tags of a list: the list itself, in its locale or every one, and each entry it shows. */
export function listTags(
  collection: string,
  locale: string | undefined,
  entries: readonly Entryish[],
): string[] {
  return [listTag(collection, locale ?? EVERY_LOCALE), ...idsOf(entries)]
}

/** The tags of the translations of a group. */
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

/** How long the edge keeps a page no event purges: a year, the most it keeps anything. */
export const EDGE_SECONDS = 31_536_000

/**
 * The headers that let the edge keep a response, tagged with what it showed: only a GET that
 * answered 200 and read Hollware. An error, a redirect or a write is never kept, nor a response
 * that read nothing to purge it by. The browser keeps nothing; only the edge does.
 */
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

/**
 * A request header that only the preview plugin sets, and that Nitro's cache (`cache: <seconds>`)
 * varies on: a preview gets a fresh value each time, so it never reads or fills the entry that
 * every other request of the same path shares.
 */
export const PREVIEW_HEADER = 'x-hollware-preview'
