import type { HollwareReader } from '@hollware/client'
import { appendResponseHeader, type H3Event } from 'h3'
import { useFetch, useRequestEvent } from 'nuxt/app'
import { entryTags, groupTags, listTags, recordTags, siteTags } from './tags.ts'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { PageEntry } from './types.ts'

export type { PageEntry } from './types.ts'

type Answer<Method extends keyof HollwareReader> = Awaited<ReturnType<HollwareReader[Method]>>

/**
 * The published content of the site, for a page: each reads the site's own `/_hollware/` route,
 * which reads Hollware on the server, so no token reaches the browser. They are `useFetch`, so the
 * page renders on the server with the answer and the browser does not ask again. On the server,
 * each records on the page's request the cache tags of what it read (S8).
 */

/** The request of the page being rendered, on the server; none in the browser. */
function pageRequest() {
  return import.meta.server ? useRequestEvent() : undefined
}

/**
 * An entry, with its Comark document; `data` is null while it loads, `error` a 404 when it is not
 * published. A visitor who opened the admin's "Preview on the site" link has the token in the
 * `hollware_preview` cookie (the server exchanged it for the link's `?hollware-preview=`), and the
 * `/_hollware/entry` route reads the latest revision of that entry instead: a draft too. The page
 * then answers `no-store`; a token that does not hold (expired, of another entry) is an error,
 * never the published version, and when Hollware says it expired or is invalid the response
 * clears the cookie.
 */
export function useHollwareEntry(
  collection: MaybeRefOrGetter<string>,
  locale: MaybeRefOrGetter<string>,
  slug: MaybeRefOrGetter<string>,
) {
  const path = computed(
    () =>
      `/_hollware/entry/${encodeURIComponent(toValue(collection))}/${encodeURIComponent(toValue(locale))}/${encodeURIComponent(toValue(slug))}`,
  )
  const event = pageRequest()
  return useFetch<{ outcome: 'ok'; entry: PageEntry }>(path, {
    transform: (answer) => {
      recordTags(event, entryTags(answer.entry))
      return answer
    },
    // The route's refusal clears the cookie on its own answer, which is the page's own request
    // to the server: hand the same `Set-Cookie` to the response of the page.
    onResponseError: ({ response }) => {
      if (event === undefined) return
      for (const cookie of response.headers.getSetCookie()) {
        // Nitro hands the page the event of h3, whichever type Nuxt gives it.
        appendResponseHeader(event as unknown as H3Event, 'set-cookie', cookie)
      }
    },
  })
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
  /** `lazy: true` renders without waiting for the answer, as `useFetch` does. */
  fetching: { lazy?: boolean } = {},
) {
  const path = computed(() => `/_hollware/entries/${encodeURIComponent(toValue(collection))}`)
  const event = pageRequest()
  return useFetch<{ outcome: 'ok'; entries: PageEntry[]; nextCursor: string | null }>(path, {
    query: computed(() => toValue(options)),
    ...fetching,
    transform: (answer) => {
      recordTags(event, listTags(toValue(collection), toValue(options).locale, answer.entries))
      return answer
    },
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
  const event = pageRequest()
  return useFetch<{ outcome: 'ok'; entries: PageEntry[] }>(path, {
    transform: (answer) => {
      recordTags(event, groupTags(toValue(collection), toValue(group), answer.entries))
      return answer
    },
  })
}

/** The site: its locales, its collections and their schemas. */
export function useHollwareSite() {
  const event = pageRequest()
  return useFetch<Answer<'describeSite'>>('/_hollware/site', {
    transform: (answer) => {
      recordTags(event, siteTags())
      return answer
    },
  })
}
