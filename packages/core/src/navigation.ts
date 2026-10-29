import * as z from 'zod'
import type { ResolvedNavigation } from './config/types.ts'
import { collectionName, locale } from './operations/schemas.ts'

/** The arguments of `getNavigation`: a collection, and a locale (the site's default when absent). */
export const navigationInput = z.strictObject({
  collection: collectionName,
  locale: locale.optional(),
})

/** The most published entries a navigation arranges; a larger collection is refused. */
export const NAVIGATION_MAX_ENTRIES = 1000

/** An entry as a sidebar links to it. */
export interface NavigationEntry {
  readonly slug: string
  /** Its frontmatter's `title`, or its slug when it has none. */
  readonly title: string
  /** Its frontmatter's `description`, or `null`. */
  readonly description: string | null
  /** Its public path by the collection's route in the locale, or `null` without one. */
  readonly path: string | null
  /** The value of the `orderBy` field, or `null`. */
  readonly order: number | null
}

/** The entries of one group; `name` is `null` for those with no value in `groupBy`, which come last. */
export interface NavigationGroup {
  readonly name: string | null
  readonly entries: readonly NavigationEntry[]
}

/** What `getNavigation` answers: the published entries of a collection in a locale, grouped and ordered. */
export interface Navigation {
  readonly outcome: 'ok'
  readonly collection: string
  readonly locale: string
  readonly groups: readonly NavigationGroup[]
}

/** A published entry as the navigation reads it. */
export interface NavigationSource {
  readonly slug: string
  readonly frontmatter: Readonly<Record<string, unknown>>
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function orderKey(entry: NavigationEntry): number {
  return entry.order ?? Number.POSITIVE_INFINITY
}

function byOrder(locale: string) {
  return (a: NavigationEntry, b: NavigationEntry): number =>
    Math.sign(orderKey(a) - orderKey(b) || 0) ||
    a.title.localeCompare(b.title, locale) ||
    compareText(a.slug, b.slug)
}

function rankOf(groups: readonly string[] | null) {
  const key = (name: string | null): number => {
    if (name === null) return Number.POSITIVE_INFINITY
    const index = groups?.indexOf(name) ?? -1
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  return (a: string | null, b: string | null): number =>
    Math.sign(key(a) - key(b) || 0) || compareText(a ?? '', b ?? '')
}

/**
 * The entries arranged as `navigation` says: grouped by its `groupBy`, the groups in the order of
 * its `groups` and then by name, the group of entries with no value last; within a group by
 * `orderBy` (no value last), then by title in the locale, then by slug. Without a navigation, one
 * group of every entry by title.
 */
export function arrangeNavigation(input: {
  readonly collection: string
  readonly locale: string
  readonly navigation: ResolvedNavigation | null
  readonly entries: readonly NavigationSource[]
  readonly pathOf: (slug: string) => string | null
}): Navigation {
  const orderBy = input.navigation?.orderBy ?? null
  const groupBy = input.navigation?.groupBy ?? null
  const groups = new Map<string | null, NavigationEntry[]>()
  for (const entry of input.entries) {
    const order = orderBy === null ? null : entry.frontmatter[orderBy]
    const name = groupBy === null ? null : textOf(entry.frontmatter[groupBy])
    const linked: NavigationEntry = {
      slug: entry.slug,
      title: textOf(entry.frontmatter['title']) ?? entry.slug,
      description: textOf(entry.frontmatter['description']),
      path: input.pathOf(entry.slug),
      order: typeof order === 'number' && Number.isFinite(order) ? order : null,
    }
    const group = groups.get(name)
    if (group === undefined) groups.set(name, [linked])
    else group.push(linked)
  }
  const names = [...groups.keys()].sort(rankOf(input.navigation?.groups ?? null))
  return {
    outcome: 'ok',
    collection: input.collection,
    locale: input.locale,
    groups: names.map((name) => ({
      name,
      entries: (groups.get(name) ?? []).sort(byOrder(input.locale)),
    })),
  }
}
