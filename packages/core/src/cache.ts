/**
 * The cache tags of Hollware's content (S8): one name for each thing a page can show, so that a
 * site tags each page with what it read and purges, when an event says what changed, the pages
 * that showed it. Hollware puts the tags an event invalidates in its payload; `@hollware/nuxt`
 * tags its pages with the same functions. A tag is at most 1,024 characters of printable ASCII
 * with no space or comma, which every cache that purges by tag takes.
 *
 * - `entry:<id>`: a page that shows the entry, its own or one that embeds it;
 * - `list:<collection>:<locale>`: a page that lists the entries of a collection in a locale, and
 *   `list:<collection>:*` one that lists them in every locale;
 * - `group:<collection>:<group>`: a page that links to the translations of a group;
 * - `site`: a page that shows the structure of the site, such as its navigation.
 */

export const SITE_TAG = 'site'

const MAX = 1024

function part(value: string): string {
  return encodeURIComponent(value).replaceAll(',', '%2C').replaceAll("'", '%27')
}

function cut(tag: string): string {
  return tag.length <= MAX ? tag : tag.slice(0, MAX)
}

export function entryTag(id: string): string {
  return cut(`entry:${part(id)}`)
}

export function listTag(collection: string, locale: string): string {
  return cut(`list:${part(collection)}:${part(locale)}`)
}

export function groupTag(collection: string, group: string): string {
  return cut(`group:${part(collection)}:${part(group)}`)
}

/** The locale of a list of every locale. */
export const EVERY_LOCALE = '*'

/** What a summary of an entry says that tags derive from. */
export interface TaggedEntry {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly translationGroup: string | null
}

/** The tags of a page that shows these entries, each its own. */
export function tagsOfEntries(entries: readonly TaggedEntry[]): string[] {
  return [...new Set(entries.map((entry) => entryTag(entry.id)))]
}

/**
 * The tags an event about an entry invalidates: the pages that show it, the lists of its
 * collection in its locale and in every locale, and the pages that link to its translations.
 */
export function tagsOfChange(entry: TaggedEntry): string[] {
  return [
    entryTag(entry.id),
    listTag(entry.collection, entry.locale),
    listTag(entry.collection, EVERY_LOCALE),
    ...(entry.translationGroup === null
      ? []
      : [groupTag(entry.collection, entry.translationGroup)]),
  ]
}

/**
 * The tags a change of a site's structure invalidates: the pages that show the structure
 * (`site`, such as a navigation), and every list of its collections in each locale and in every
 * locale, as a list may change with a schema, a route or a collection that goes. `collections` and
 * `locales` are those of the definition before and after the change, together.
 */
export function tagsOfSiteChange(
  collections: readonly string[],
  locales: readonly string[],
): string[] {
  const tags = new Set([SITE_TAG])
  for (const collection of collections) {
    for (const locale of [...locales, EVERY_LOCALE]) tags.add(listTag(collection, locale))
  }
  return [...tags]
}
