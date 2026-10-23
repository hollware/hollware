import { en as uiEn, es as uiEs } from '@nuxt/ui/locale'
import { computed, ref } from 'vue'
import { en, type Messages } from './en.ts'
import { es } from './es.ts'

export type Locale = 'en' | 'es'

export const LANGUAGES: readonly { readonly locale: Locale; readonly name: string }[] = [
  { locale: 'en', name: 'English' },
  { locale: 'es', name: 'Español' },
]

const KEY = 'hollware.locale'
const CATALOG: Readonly<Record<Locale, Messages>> = { en, es }

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'es'
}

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

export function useMessages() {
  return messages
}

export const currentLocale = computed(() => locale.value)

export const uiLocale = computed(() => (locale.value === 'es' ? uiEs : uiEn))

export function setLocale(next: Locale): void {
  locale.value = next
  try {
    globalThis.localStorage?.setItem(KEY, next)
  } catch {}
  mark(next)
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale.value).format(new Date(iso))
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(locale.value).format(value)
}
