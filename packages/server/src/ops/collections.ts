import { HollwareError, type ResolvedCollection, type ResolvedSite } from '@hollware/core'
import type { StoredEntry } from '../ports.ts'

const NAME_LIMIT = 60

function shown(name: string): string {
  if (name.length <= NAME_LIMIT) return JSON.stringify(name)
  const head = name.slice(0, NAME_LIMIT)
  const last = head.charCodeAt(NAME_LIMIT - 1)
  return JSON.stringify(`${last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head}…`)
}

export function requireCollection(site: ResolvedSite, name: string): ResolvedCollection {
  const collection = site.collections.get(name)
  if (collection !== undefined) return collection
  throw new HollwareError(
    'unknown_collection',
    `The site has no collection ${shown(name)}.`,
    `Use one of its collections: ${[...site.collections.keys()].join(', ')}. describe_site lists them with their schemas.`,
  )
}

export function requireLocale(site: ResolvedSite, locale: string): void {
  if (site.locales.includes(locale)) return
  throw new HollwareError(
    'unknown_locale',
    `The site has no locale ${shown(locale)}.`,
    `Use one of its locales: ${site.locales.join(', ')}.`,
  )
}

export function collectionOfEntry(site: ResolvedSite, entry: StoredEntry): ResolvedCollection {
  const collection = site.collections.get(entry.collection)
  if (collection !== undefined) return collection
  throw new HollwareError(
    'unknown_collection',
    `The entry ${entry.id} belongs to the collection ${shown(entry.collection)}, which the config of the site no longer declares.`,
    `Ask an owner of the site to add the collection ${shown(entry.collection)} again, with set_collection or in the admin: the entry and its revisions are kept.`,
  )
}
