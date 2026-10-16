import { en } from '../i18n/en'
import { es } from '../i18n/es'

/** The languages of hollware.com: English at the root, Spanish under `/es/`. */
export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

const MESSAGES = { en, es } as const

/** The locale of a path: Spanish under `/es/`, English everywhere else. */
export function localeOfPath(path: string): Locale {
  return path === '/es' || path.startsWith('/es/') ? 'es' : 'en'
}

/** A path of the site (`/docs/x/`) in `locale`, from its English path. */
export function pathIn(locale: Locale, path: string): string {
  if (locale === 'en') return path
  return path === '/' ? '/es/' : `/es${path}`
}

/** The English path of any path of the site. */
export function basePath(path: string): string {
  if (localeOfPath(path) === 'en') return path
  const rest = path.slice('/es'.length)
  return rest === '' ? '/' : rest
}

/** The locale of the page, its words, and its paths. */
export function useLocale() {
  const route = useRoute()
  const locale = computed(() => localeOfPath(route.path))
  return {
    locale,
    m: computed(() => MESSAGES[locale.value]),
    to: (path: string) => pathIn(locale.value, path),
  }
}
