import type { Locale } from './useLocale'

export async function useDocsPages(locale: Locale) {
  const route = useRoute()
  const { m } = useLocale()
  const [own, english] = await Promise.all([
    useHollwareNavigation('docs', { locale }),
    locale === 'en' ? null : useHollwareNavigation('docs', { locale: 'en' }),
  ])
  const failed = own.error.value ?? english?.error.value
  if (failed) failRead(failed, route.fullPath, m.value.docs.empty)
  return computed(() => docLinks(own.data.value, locale, english?.data.value ?? null))
}
