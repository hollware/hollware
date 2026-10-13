/**
 * The paths of the blog. They mirror the `routes` of the `blog` collection in Hollware's
 * hollware.config.ts (`/blog/:slug/` for Spanish and `/en/blog/:slug/` for English): the internal
 * links of an entry's Markdown point at those paths, so this site has to serve them.
 */

export const LOCALES = ['es', 'en'] as const

export type Locale = (typeof LOCALES)[number]

const BLOG_ROOT: Readonly<Record<Locale, string>> = { es: '/blog/', en: '/en/blog/' }

/** The slug of an entry: the rule of Hollware's `slug` input, which a request is checked against. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 200

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

/** The path of the blog index of a locale. */
export function blogPath(locale: Locale): string {
  return BLOG_ROOT[locale]
}

/** The path of an entry. */
export function entryPath(locale: Locale, slug: string): string {
  return `${BLOG_ROOT[locale]}${slug}/`
}

export type Route =
  | { readonly kind: 'index'; readonly locale: Locale }
  | { readonly kind: 'entry'; readonly locale: Locale; readonly slug: string }
  /** The path without its trailing slash: every page of the site ends in one. */
  | { readonly kind: 'redirect'; readonly to: string }

/** What a path is, or `null` when this site serves nothing at it. */
export function matchRoute(pathname: string): Route | null {
  for (const locale of LOCALES) {
    const root = BLOG_ROOT[locale]
    if (pathname === root) return { kind: 'index', locale }
    if (pathname === root.slice(0, -1)) return { kind: 'redirect', to: root }
    if (!pathname.startsWith(root)) continue
    const rest = pathname.slice(root.length)
    const slashed = rest.endsWith('/')
    const slug = slashed ? rest.slice(0, -1) : rest
    if (slug.length > MAX_SLUG_LENGTH || !SLUG.test(slug)) return null
    return slashed ? { kind: 'entry', locale, slug } : { kind: 'redirect', to: `${root}${slug}/` }
  }
  return null
}
