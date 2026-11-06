import { trimLeadingControls, urlScheme } from './policy.ts'
import type { LinkRef, LinkTarget } from './types.ts'

export interface CompiledRoute {
  readonly collection: string
  readonly locale: string
  readonly segments: readonly string[]
  readonly slugAt: number
  readonly maxDepth: number
}

const SLUG = ':slug'

function segmentsOf(path: string): string[] {
  const segments = path.slice(1).split('/')
  if (segments[segments.length - 1] === '') segments.pop()
  return segments
}

export function compileRoutes(
  routes: Readonly<Record<string, Readonly<Record<string, string>>>>,
  depths: Readonly<Record<string, number>> = {},
): CompiledRoute[] {
  const compiled: CompiledRoute[] = []
  for (const collection of Object.keys(routes).sort()) {
    const byLocale = routes[collection] ?? {}
    const maxDepth = depths[collection] ?? 1
    for (const locale of Object.keys(byLocale).sort()) {
      const pattern = byLocale[locale] ?? ''
      if (!pattern.startsWith('/')) continue
      const segments = segmentsOf(pattern)
      const slugAt = segments.indexOf(SLUG)
      if (slugAt !== -1) compiled.push({ collection, locale, segments, slugAt, maxDepth })
    }
  }
  return compiled
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function matchesAt(path: readonly string[], route: CompiledRoute, depth: number): boolean {
  const tail = route.segments.length - route.slugAt - 1
  if (path.length !== route.segments.length - 1 + depth) return false
  for (let at = 0; at < route.slugAt; at++) {
    if (path[at] !== route.segments[at]) return false
  }
  for (let at = route.slugAt; at < route.slugAt + depth; at++) {
    if ((path[at] ?? '') === '') return false
  }
  for (let at = 0; at < tail; at++) {
    if (path[route.slugAt + depth + at] !== route.segments[route.slugAt + 1 + at]) return false
  }
  return true
}

/**
 * The entry a site path names, by the routes: the collection, the locale and the slug, the last
 * of the segments that take the place of `:slug`; `slugPath` holds them all, joined by `/`.
 */
export function matchRoute(
  path: string,
  routes: readonly CompiledRoute[],
): (LinkTarget & { readonly slugPath: string; readonly nested: boolean }) | undefined {
  const segments = segmentsOf(path)
  for (const route of routes) {
    for (let depth = 1; depth <= route.maxDepth; depth++) {
      if (!matchesAt(segments, route, depth)) continue
      const slugs = segments.slice(route.slugAt, route.slugAt + depth).map(safeDecode)
      return {
        collection: route.collection,
        locale: route.locale,
        slug: slugs[slugs.length - 1] ?? '',
        slugPath: slugs.join('/'),
        nested: route.maxDepth > 1,
      }
    }
  }
  return undefined
}

export interface Classification {
  readonly kind: LinkRef['kind']
  readonly target?: LinkTarget
}

export function classifyLink(href: string, routes: readonly CompiledRoute[]): Classification {
  const value = trimLeadingControls(href)
  if (value.startsWith('#')) return { kind: 'anchor' }
  if (urlScheme(value) !== undefined || value.startsWith('//')) return { kind: 'external' }
  if (value.startsWith('/')) {
    const end = value.search(/[?#]/)
    const matched = matchRoute(end === -1 ? value : value.slice(0, end), routes)
    if (matched !== undefined) {
      return {
        kind: 'internal',
        target: {
          collection: matched.collection,
          locale: matched.locale,
          slug: matched.slug,
          ...(matched.nested ? { slugPath: matched.slugPath } : {}),
        },
      }
    }
  }
  return { kind: 'site' }
}
