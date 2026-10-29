import type { Locale } from './useLocale'

export async function useDocsPages(locale: Locale) {
  const route = useRoute()
  const { m } = useLocale()
  const [own, english] = await Promise.all([
    useHollwareEntries('docs', { locale, limit: 100 }),
    locale === 'en' ? null : useHollwareEntries('docs', { locale: 'en', limit: 100 }),
  ])
  const failed = own.error.value ?? english?.error.value
  if (failed) failRead(failed, route.fullPath, m.value.docs.empty)
  return computed(() =>
    readingOrder(own.data.value?.entries ?? [], locale, english?.data.value?.entries ?? []),
  )
}
