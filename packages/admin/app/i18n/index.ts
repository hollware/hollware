import { en as uiEn, es as uiEs } from '@nuxt/ui/locale'
import { computed, ref } from 'vue'
import { en, type Messages } from './en.ts'
import { es } from './es.ts'

/**
 * The language of the admin: English or Spanish. It is the one the person chose (kept in local
 * storage), or else the first language of the browser that it speaks, and English otherwise. Templates read
 * their texts through `useMessages()` (`m.nav.home`), and dates and numbers are written in the
 * same language.
 */

export type Locale = 'en' | 'es'

/** The languages to choose from, each named in itself. */
export const LANGUAGES: readonly { readonly locale: Locale; readonly name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'es', name: 'Español' },
]

const KEY = 'hollware.locale'
const CATALOG: Readonly<Record<Locale, Messages>> = { en, es }

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es'
}

/**
 * The language to start in: the one kept, or else the first language of the browser that the
 * admin speaks, and English when it speaks none of them.
 */
export function initialLocale(stored: string | null, languages: readonly string[]): Locale {
  if (isLocale(stored)) return stored
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

function stored(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

const locale = ref<Locale>(
  initialLocale(
    stored(),
    globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? ''],
  ),
)

function mark(next: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = next
}
mark(locale.value)

const messages = computed(() => CATALOG[locale.value])

/** The texts of the current language. */
export function useMessages() {
  return messages
}

/** The current language, to read. */
export const currentLocale = computed(() => locale.value)

/** Nuxt UI's own texts, in the current language, for `<UApp :locale>`. */
export const uiLocale = computed(() => (locale.value === 'es' ? uiEs : uiEn))

/** Switches the language, keeps it for the next visit and says it on the page (`<html lang>`). */
export function setLocale(next: Locale): void {
  locale.value = next
  try {
    globalThis.localStorage?.setItem(KEY, next)
  } catch {
    // Storage may be blocked: the choice then lasts as long as the page.
  }
  mark(next)
}

/** A date and time as the person reads them, in the admin's language and their own zone. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

/** A date, in the admin's language. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(iso))
}

/** A number, in the admin's language. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}
