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
  /** In a nested collection, the slug of its parent; `null` at the root and in a flat one. */
  readonly parent: string | null
  /** In a nested collection, its children in their order; empty in a flat one. */
  readonly children: readonly NavigationEntry[]
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
  /** In a nested collection: the slug of its parent, or `null` at the root. */
  readonly parent?: string | null
  /** In a nested collection: its place among its siblings. */
  readonly position?: number | null
  /** The slugs of its ancestors and its own, joined by `/`; its slug when absent. */
  readonly slugPath?: string
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

function byPosition(locale: string) {
  const key = (entry: { readonly position: number | null }) =>
    entry.position ?? Number.POSITIVE_INFINITY
  return (a: Ranked, b: Ranked): number =>
    Math.sign(key(a) - key(b) || 0) ||
    a.entry.title.localeCompare(b.entry.title, locale) ||
    compareText(a.entry.slug, b.entry.slug)
}

interface Ranked {
  readonly entry: NavigationEntry
  readonly position: number | null
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
 * group of every entry by title. In a nested collection the groups hold the roots, and each entry
 * its children, by their position, then title, then slug; an entry whose parent is not among the
 * entries is a root.
 */
export function arrangeNavigation(input: {
  readonly collection: string
  readonly locale: string
  readonly navigation: ResolvedNavigation | null
  readonly nested?: boolean
  readonly entries: readonly NavigationSource[]
  readonly pathOf: (slugPath: string) => string | null
}): Navigation {
  const orderBy = input.navigation?.orderBy ?? null
  const groupBy = input.navigation?.groupBy ?? null
  const nested = input.nested === true
  const present = new Set(input.entries.map((entry) => entry.slug))
  const children = new Map<string, Ranked[]>()
  const groups = new Map<string | null, Ranked[]>()
  const built = new Map<string, NavigationEntry>()
  for (const entry of input.entries) {
    const order = orderBy === null ? null : entry.frontmatter[orderBy]
    const parent = nested && entry.parent != null && present.has(entry.parent) ? entry.parent : null
    const linked: NavigationEntry = {
      slug: entry.slug,
      title: textOf(entry.frontmatter['title']) ?? entry.slug,
      description: textOf(entry.frontmatter['description']),
      path: input.pathOf(entry.slugPath ?? entry.slug),
      order: typeof order === 'number' && Number.isFinite(order) ? order : null,
      parent,
      children: [],
    }
    built.set(entry.slug, linked)
    const ranked = { entry: linked, position: nested ? (entry.position ?? null) : null }
    if (parent !== null) {
      const siblings = children.get(parent)
      if (siblings === undefined) children.set(parent, [ranked])
      else siblings.push(ranked)
      continue
    }
    const name = groupBy === null ? null : textOf(entry.frontmatter[groupBy])
    const group = groups.get(name)
    if (group === undefined) groups.set(name, [ranked])
    else group.push(ranked)
  }
  const sortSiblings = nested ? byPosition(input.locale) : null
  const byOrderOf = byOrder(input.locale)
  const finish = (ranked: Ranked[], seen: ReadonlySet<string>): NavigationEntry[] =>
    ranked.sort(sortSiblings ?? ((a, b) => byOrderOf(a.entry, b.entry))).map(({ entry }) => {
      const own = children.get(entry.slug)
      if (own === undefined || seen.has(entry.slug)) return entry
      return { ...entry, children: finish(own, new Set([...seen, entry.slug])) }
    })
  const names = [...groups.keys()].sort(rankOf(input.navigation?.groups ?? null))
  return {
    outcome: 'ok',
    collection: input.collection,
    locale: input.locale,
    groups: names.map((name) => ({
      name,
      entries: finish(groups.get(name) ?? [], new Set()),
    })),
  }
}

/** Every entry of a navigation, depth first, in the order a sidebar shows them: for previous and next. */
export function flattenNavigation(navigation: Pick<Navigation, 'groups'>): NavigationEntry[] {
  const flat: NavigationEntry[] = []
  const walk = (entries: readonly NavigationEntry[]) => {
    for (const entry of entries) {
      flat.push(entry)
      walk(entry.children)
    }
  }
  for (const group of navigation.groups) walk(group.entries)
  return flat
}

/** The entries from the root down to the one with `slug`, itself last: for breadcrumbs. Empty when it is not there. */
export function trailOf(navigation: Pick<Navigation, 'groups'>, slug: string): NavigationEntry[] {
  const find = (entries: readonly NavigationEntry[]): NavigationEntry[] | null => {
    for (const entry of entries) {
      if (entry.slug === slug) return [entry]
      const below = find(entry.children)
      if (below !== null) return [entry, ...below]
    }
    return null
  }
  for (const group of navigation.groups) {
    const found = find(group.entries)
    if (found !== null) return found
  }
  return []
}
