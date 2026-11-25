import { embeddedPreviewToken, PREVIEW_COOKIE, previewTokenFromCookie } from '@hollware/client'
import {
  entryTag,
  EVERY_LOCALE,
  groupTag,
  listTag,
  PREVIEW_EMBED_PARAM,
  PREVIEW_QUERY_PARAM,
  SITE_TAG,
} from '@hollware/core'

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

export function navigationTags(collection: string, locale: string): string[] {
  return [listTag(collection, locale)]
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
    'cache-control': 'public, max-age=0',
    'cloudflare-cdn-cache-control': `max-age=${EDGE_SECONDS}, stale-if-error=${EDGE_SECONDS}`,
  }
}

export const PREVIEW_HEADER = 'x-hollware-preview'

export function markPreviewRequest(headers: Record<string, string | string[] | undefined>): void {
  const cookie = headers['cookie']
  if (previewTokenFromCookie(typeof cookie === 'string' ? cookie : undefined) === undefined) {
    delete headers[PREVIEW_HEADER]
  } else headers[PREVIEW_HEADER] = crypto.randomUUID()
}

export function embedPreviewRequest(
  headers: Record<string, string | string[] | undefined>,
  url: URL,
): boolean {
  const token = embeddedPreviewToken(url)
  if (token === undefined) return false
  const cookie = headers['cookie']
  headers['cookie'] =
    typeof cookie === 'string' && cookie !== ''
      ? `${PREVIEW_COOKIE}=${token}; ${cookie}`
      : `${PREVIEW_COOKIE}=${token}`
  return true
}

export function embedFrameAncestors(hollwareUrl: string): string | null {
  if (hollwareUrl === '') return null
  try {
    return `frame-ancestors ${new URL(hollwareUrl).origin}`
  } catch {
    return null
  }
}

export function withoutPreviewToken(path: string): string {
  const at = path.indexOf('?')
  if (at === -1) return path
  const kept = path
    .slice(at + 1)
    .split('&')
    .filter((pair) => {
      const name = pair.split('=')[0] ?? ''
      let decoded = name
      try {
        decoded = decodeURIComponent(name)
      } catch {
        decoded = name
      }
      return pair !== '' && decoded !== PREVIEW_QUERY_PARAM
    })
  return kept.length === 0 ? path.slice(0, at) : `${path.slice(0, at)}?${kept.join('&')}`
}

export function isEmbeddedPage(url: string): boolean {
  return new URL(url).searchParams.get(PREVIEW_EMBED_PARAM) === '1'
}

export function embedScrollKey(url: string): string | null {
  return isEmbeddedPage(url) ? `hollware-embed-scroll:${new URL(url).pathname}` : null
}
