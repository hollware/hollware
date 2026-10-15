import type { HollwareReader } from '@hollware/client'
import { useFetch } from 'nuxt/app'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { PageEntry } from './types.ts'

export type { PageEntry } from './types.ts'

type Answer<Method extends keyof HollwareReader> = Awaited<ReturnType<HollwareReader[Method]>>

/**
 * The published content of the site, for a page: each reads the site's own `/_hollware/` route,
 * which reads Hollware on the server, so no token reaches the browser. They are `useFetch`, so the
 * page renders on the server with the answer and the browser does not ask again.
 */

/** An entry, with its Comark document; `data` is null while it loads, `error` a 404 when it is not published. */
export function useHollwareEntry(
  collection: MaybeRefOrGetter<string>,
  locale: MaybeRefOrGetter<string>,
  slug: MaybeRefOrGetter<string>,
) {
  const path = computed(
    () =>
      `/_hollware/entry/${encodeURIComponent(toValue(collection))}/${encodeURIComponent(toValue(locale))}/${encodeURIComponent(toValue(slug))}`,
  )
  return useFetch<{ outcome: 'ok'; entry: PageEntry }>(path, { key: path.value })
}

/** A page of the published entries of a collection, newest first. */
export function useHollwareEntries(
  collection: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<{
    locale?: string
    tag?: string
    limit?: number
    cursor?: string
  }> = {},
) {
  const path = computed(() => `/_hollware/entries/${encodeURIComponent(toValue(collection))}`)
  return useFetch<{ outcome: 'ok'; entries: PageEntry[]; nextCursor: string | null }>(path, {
    query: computed(() => toValue(options)),
  })
}

/** The entries of a translation group, one per locale. */
export function useHollwareTranslations(
  collection: MaybeRefOrGetter<string>,
  group: MaybeRefOrGetter<string>,
) {
  const path = computed(
    () =>
      `/_hollware/translations/${encodeURIComponent(toValue(collection))}/${encodeURIComponent(toValue(group))}`,
  )
  return useFetch<{ outcome: 'ok'; entries: PageEntry[] }>(path)
}

/** The site: its locales, its collections and their schemas. */
export function useHollwareSite() {
  return useFetch<Answer<'describeSite'>>('/_hollware/site')
}
