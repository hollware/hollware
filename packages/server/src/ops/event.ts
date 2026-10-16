import {
  newId,
  tagsOfChange,
  tagsOfSiteChange,
  type ResolvedCollection,
  type ResolvedSite,
} from '@hollware/core'
import type { OutboxEvent } from '../ports.ts'

/** The events about an entry. */
export type EntryEventKind = 'entry.published' | 'entry.unpublished'
export type EventKind = EntryEventKind | 'site.changed'

/** What every event says: which, of which site, when, and the cache tags it invalidates. */
interface EventBase {
  readonly id: string
  readonly site: string
  /** When the write was made, in ISO 8601. */
  readonly at: string
  /** The cache tags the change invalidates (`@hollware/core`), for a site to purge. */
  readonly cacheTags: readonly string[]
}

/** What a subscriber gets of a site whose structure changed (ADR-033): no entry, the tags to purge. */
export interface SiteEventPayload extends EventBase {
  readonly kind: 'site.changed'
}

/** What a subscriber gets: an event about an entry, or about the structure of the site. */
export type EventPayload = EntryEventPayload | SiteEventPayload

/** What a subscriber gets of a publish or an unpublish: the entry, and where it lives. */
export interface EntryEventPayload extends EventBase {
  readonly kind: EntryEventKind
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
  readonly kind: EntryEventKind
  readonly site: ResolvedSite
  readonly collection: ResolvedCollection
  readonly entry: EntryEventPayload['entry']
  readonly at: string
}): OutboxEvent {
  const id = newId('evt')
  const path = entryPath(input.collection, input.entry.locale, input.entry.slug)
  const payload: EntryEventPayload = {
    id,
    kind: input.kind,
    site: input.site.key,
    at: input.at,
    entry: input.entry,
    path,
    url: path === null || input.site.url === null ? null : `${input.site.url}${path}`,
    cacheTags: tagsOfChange(input.entry),
  }
  return { id, payload: JSON.stringify(payload) }
}

/**
 * The event of a change of a site's structure, ready for the outbox: the tags of the site and of
 * every list of the collections and locales of its definition before and after the change.
 */
export function siteEventFor(input: {
  readonly site: string
  readonly at: string
  readonly collections: readonly string[]
  readonly locales: readonly string[]
}): OutboxEvent {
  const id = newId('evt')
  const payload: SiteEventPayload = {
    id,
    kind: 'site.changed',
    site: input.site,
    at: input.at,
    cacheTags: tagsOfSiteChange(input.collections, input.locales),
  }
  return { id, payload: JSON.stringify(payload) }
}
