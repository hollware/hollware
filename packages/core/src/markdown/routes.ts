import { trimLeadingControls, urlScheme } from './policy.ts'
import type { LinkRef, LinkTarget } from './types.ts'

export interface CompiledRoute {
  readonly collection: string
  readonly locale: string
  readonly segments: readonly string[]
  readonly slugAt: number
}

const SLUG = ':slug'

function segmentsOf(path: string): string[] {
  const segments = path.slice(1).split('/')
  if (segments[segments.length - 1] === '') segments.pop()
  return segments
}

export function compileRoutes(
  routes: Readonly<Record<string, Readonly<Record<string, string>>>>,
): CompiledRoute[] {
  const compiled: CompiledRoute[] = []
  for (const collection of Object.keys(routes).sort()) {
    const byLocale = routes[collection] ?? {}
    for (const locale of Object.keys(byLocale).sort()) {
      const pattern = byLocale[locale] ?? ''
      if (!pattern.startsWith('/')) continue
      const segments = segmentsOf(pattern)
      const slugAt = segments.indexOf(SLUG)
      if (slugAt !== -1) compiled.push({ collection, locale, segments, slugAt })
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

function matchRoute(path: string, routes: readonly CompiledRoute[]): LinkTarget | undefined {
  const segments = segmentsOf(path)
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue
    let matches = true
    for (let at = 0; at < segments.length && matches; at++) {
      const segment = segments[at] ?? ''
      matches = at === route.slugAt ? segment !== '' : segment === route.segments[at]
    }
    if (matches) {
      return {
        collection: route.collection,
        locale: route.locale,
        slug: safeDecode(segments[route.slugAt] ?? ''),
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
    const target = matchRoute(end === -1 ? value : value.slice(0, end), routes)
    if (target !== undefined) return { kind: 'internal', target }
  }
  return { kind: 'site' }
}
