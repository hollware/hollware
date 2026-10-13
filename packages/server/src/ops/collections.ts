import { HollwareError, type ResolvedCollection, type ResolvedSite } from '@hollware/core'
import type { StoredEntry } from '../ports.ts'

/**
 * Which collection and locale a call names, checked against the config of the site before
 * anything else is done with it. The fixes list what the site has, so that an agent that guessed
 * a name has the right one in the answer.
 */

/** The longest name an error repeats: a caller could send any string. */
const NAME_LIMIT = 60

/** A name the caller sent, as an error shows it: in JSON quotes, so on one line, and cut when it is long. */
function shown(name: string): string {
  if (name.length <= NAME_LIMIT) return JSON.stringify(name)
  const head = name.slice(0, NAME_LIMIT)
  // Never cut a character that takes two code units in half.
  const last = head.charCodeAt(NAME_LIMIT - 1)
  return JSON.stringify(`${last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head}…`)
}

/** The collection of the site with that name, or `unknown_collection` listing the ones it has. */
export function requireCollection(site: ResolvedSite, name: string): ResolvedCollection {
  const collection = site.collections.get(name)
  if (collection !== undefined) return collection
  throw new HollwareError(
    'unknown_collection',
    `The site has no collection ${shown(name)}.`,
    `Use one of its collections: ${[...site.collections.keys()].join(', ')}. describe_site lists them with their schemas.`,
  )
}

/** Whether the site has the locale, or `unknown_locale` listing the ones it has. */
export function requireLocale(site: ResolvedSite, locale: string): void {
  if (site.locales.includes(locale)) return
  throw new HollwareError(
    'unknown_locale',
    `The site has no locale ${shown(locale)}.`,
    `Use one of its locales: ${site.locales.join(', ')}.`,
  )
}

/**
 * The collection of an entry that is stored. The caller named the entry by its id, so a
 * collection that is gone from the config is no mistake of the caller: the entry and its
 * revisions are kept, and whoever maintains the config can declare the collection again. Without
 * it nothing can be checked, so the entry cannot be written or published until then.
 */
export function collectionOfEntry(site: ResolvedSite, entry: StoredEntry): ResolvedCollection {
  const collection = site.collections.get(entry.collection)
  if (collection !== undefined) return collection
  throw new HollwareError(
    'unknown_collection',
    `The entry ${entry.id} belongs to the collection ${shown(entry.collection)}, which the config of the site no longer declares.`,
    `Ask whoever maintains hollware.config.ts to declare the collection ${shown(entry.collection)} again: the entry and its revisions are kept.`,
  )
}
