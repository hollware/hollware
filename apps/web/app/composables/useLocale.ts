import { en } from '../i18n/en'
import { es } from '../i18n/es'

export const LOCALES = ['en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

const MESSAGES = { en, es } as const

export function localeOfPath(path: string): Locale {
  return path === '/es' || path.startsWith('/es/') ? 'es' : 'en'
}

export function pathIn(locale: Locale, path: string): string {
  if (locale === 'en') return path
  return path === '/' ? '/es/' : `/es${path}`
}

export function basePath(path: string): string {
  if (localeOfPath(path) === 'en') return path
  const rest = path.slice('/es'.length)
  return rest === '' ? '/' : rest
}

export function useLocale() {
  const route = useRoute()
  const locale = computed(() => localeOfPath(route.path))
  return {
    locale,
    m: computed(() => MESSAGES[locale.value]),
    to: (path: string) => pathIn(locale.value, path),
  }
}
