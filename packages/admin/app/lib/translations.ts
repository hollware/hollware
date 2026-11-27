import { ApiError, type Api, type Output } from './api.ts'

type Dated = { readonly createdAt: string }
type Summary = Output<'list_entries'>['entries'][number]

export function sourceWhenTranslated<R extends Dated>(
  newestFirst: readonly R[],
  translatedAt: string,
): R | undefined {
  return newestFirst.find((revision) => revision.createdAt <= translatedAt)
}

export interface Translated {
  readonly collection: string
  readonly locale: string
  readonly slugPath: string
  readonly translationGroup: string | null
}

export interface TranslatedCollection {
  readonly singleton?: boolean
  readonly translationGroupField: string | null
}

export async function translationsOf(
  api: Api,
  entry: Translated,
  collection: TranslatedCollection,
  locales: readonly string[],
  signal?: AbortSignal,
): Promise<Summary[]> {
  const found = await translationsFound(api, entry, collection, locales, signal)
  const rank = (locale: string) => {
    const index = locales.indexOf(locale)
    return index === -1 ? locales.length : index
  }
  return found.toSorted((a, b) => rank(a.locale) - rank(b.locale))
}

async function translationsFound(
  api: Api,
  entry: Translated,
  collection: TranslatedCollection,
  locales: readonly string[],
  signal?: AbortSignal,
): Promise<Summary[]> {
  if (entry.translationGroup !== null && collection.translationGroupField !== null) {
    const answer = await absent(
      api.call(
        'get_translations',
        { collection: entry.collection, translationGroup: entry.translationGroup },
        signal,
      ),
    )
    return answer?.entries ?? []
  }
  if (collection.singleton === true) {
    const answer = await api.call(
      'list_entries',
      { collection: entry.collection, limit: 100 },
      signal,
    )
    return answer.entries
  }
  const found = await Promise.all(
    locales.map(async (locale) => {
      const answer = await absent(
        api.call(
          'get_entry',
          { collection: entry.collection, locale, slug: entry.slugPath },
          signal,
        ),
      )
      return answer?.entry ?? null
    }),
  )
  return found.filter((other) => other !== null)
}

async function absent<Answer>(answer: Promise<Answer>): Promise<Answer | null> {
  try {
    return await answer
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return null
    throw error
  }
}
