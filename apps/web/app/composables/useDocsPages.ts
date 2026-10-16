import type { Locale } from './useLocale'

/**
 * Every published page of the docs in `locale`, in reading order, for the sidebar and prev/next
 * links. In Spanish, a page not translated yet stands in English, at its Spanish path.
 */
export async function useDocsPages(locale: Locale) {
  const [own, english] = await Promise.all([
    useHollwareEntries('docs', { locale, limit: 100 }),
    locale === 'en' ? null : useHollwareEntries('docs', { locale: 'en', limit: 100 }),
  ])
  return computed(() =>
    readingOrder(own.data.value?.entries ?? [], locale, english?.data.value?.entries ?? []),
  )
}
