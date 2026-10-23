export const LOCALES = ['es', 'en'] as const

export type Locale = (typeof LOCALES)[number]

const BLOG_ROOT: Readonly<Record<Locale, string>> = { es: '/blog/', en: '/en/blog/' }

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 200

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale === value)
}

export function blogPath(locale: Locale): string {
  return BLOG_ROOT[locale]
}

export function entryPath(locale: Locale, slug: string): string {
  return `${BLOG_ROOT[locale]}${slug}/`
}

export type Route =
  | { readonly kind: 'index'; readonly locale: Locale }
  | { readonly kind: 'entry'; readonly locale: Locale; readonly slug: string }
  | { readonly kind: 'redirect'; readonly to: string }

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
