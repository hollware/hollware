import {
  newId,
  tagsOfChange,
  tagsOfSiteChange,
  type EntryEvent,
  type HollwareEvent,
  type ResolvedCollection,
  type ResolvedSite,
  type SiteEvent,
} from '@hollware/core'
import type { OutboxEvent } from '../ports.ts'

/** The events about an entry. */
export type EntryEventKind = EntryEvent['kind']
export type EventKind = HollwareEvent['kind']

/** What a subscriber gets: the events of `@hollware/core`, which webhooks receive as they are. */
export type EventPayload = HollwareEvent
export type EntryEventPayload = EntryEvent
export type SiteEventPayload = SiteEvent

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
