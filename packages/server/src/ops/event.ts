import { newId, type ResolvedCollection, type ResolvedSite } from '@hollware/core'
import type { OutboxEvent } from '../ports.ts'

export type EventKind = 'entry.published' | 'entry.unpublished'

/** What a subscriber gets: the event, the entry it is about, and where the entry lives. */
export interface EventPayload {
  readonly id: string
  readonly kind: EventKind
  readonly site: string
  /** When the write was made, in ISO 8601. */
  readonly at: string
  readonly entry: {
    readonly id: string
    readonly collection: string
    readonly locale: string
    readonly slug: string
    readonly translationGroup: string | null
  }
  /** The path of the entry on the site, from the route of its collection and locale. */
  readonly path: string | null
  /** The URL of the entry, when the site declares its `url`. */
  readonly url: string | null
}

/** The path of an entry: the route of its locale, with its slug in place of `:slug`. */
export function entryPath(
  collection: ResolvedCollection,
  locale: string,
  slug: string,
): string | null {
  const route = collection.routes[locale]
  return route === undefined ? null : route.replace(/:slug(?![A-Za-z0-9_])/, slug)
}

/** The event of a publish or an unpublish, ready for the outbox. */
export function eventFor(input: {
  readonly kind: EventKind
  readonly site: ResolvedSite
  readonly collection: ResolvedCollection
  readonly entry: EventPayload['entry']
  readonly at: string
}): OutboxEvent {
  const id = newId('evt')
  const path = entryPath(input.collection, input.entry.locale, input.entry.slug)
  const payload: EventPayload = {
    id,
    kind: input.kind,
    site: input.site.key,
    at: input.at,
    entry: input.entry,
    path,
    url: path === null || input.site.url === null ? null : `${input.site.url}${path}`,
  }
  return { id, payload: JSON.stringify(payload) }
}
