/** Every published page of the docs, in reading order, for the sidebar and prev/next links. */
export async function useDocsPages() {
  const { data } = await useHollwareEntries('docs', { locale: 'en', limit: 100 })
  return computed(() => readingOrder(data.value?.entries ?? []))
}
