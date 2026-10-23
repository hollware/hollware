import type { Locale } from './useLocale'

export async function useDocsPages(locale: Locale) {
  const [own, english] = await Promise.all([
    useHollwareEntries('docs', { locale, limit: 100 }),
    locale === 'en' ? null : useHollwareEntries('docs', { locale: 'en', limit: 100 }),
  ])
  return computed(() =>
    readingOrder(own.data.value?.entries ?? [], locale, english?.data.value?.entries ?? []),
  )
}
