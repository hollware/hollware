import type { HollwareReader } from '@hollware/client'
import { appendResponseHeader, type H3Event } from 'h3'
import { useFetch, useRequestEvent } from 'nuxt/app'
import { entryTags, groupTags, listTags, navigationTags, recordTags, siteTags } from './tags.ts'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { PageEntry } from './types.ts'

export type { PageEntry } from './types.ts'

type Answer<Method extends keyof HollwareReader> = Awaited<ReturnType<HollwareReader[Method]>>

function pageRequest() {
  return import.meta.server ? useRequestEvent() : undefined
}

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
    onResponseError: ({ response }) => {
      if (event === undefined) return
      for (const cookie of response.headers.getSetCookie()) {
        appendResponseHeader(event as unknown as H3Event, 'set-cookie', cookie)
      }
    },
  })
}

export function useHollwareEntries(
  collection: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<{
    locale?: string
    tag?: string
    limit?: number
    cursor?: string
  }> = {},
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

export function useHollwareNavigation(
  collection: MaybeRefOrGetter<string>,
  options: MaybeRefOrGetter<{ locale?: string }> = {},
  fetching: { lazy?: boolean } = {},
) {
  const path = computed(() => `/_hollware/navigation/${encodeURIComponent(toValue(collection))}`)
  const event = pageRequest()
  return useFetch<Answer<'getNavigation'>>(path, {
    query: computed(() => toValue(options)),
    ...fetching,
    transform: (answer) => {
      recordTags(event, navigationTags(toValue(collection), answer.locale))
      return answer
    },
  })
}

export function useHollwareSite() {
  const event = pageRequest()
  return useFetch<Answer<'describeSite'>>('/_hollware/site', {
    transform: (answer) => {
      recordTags(event, siteTags())
      return answer
    },
  })
}
