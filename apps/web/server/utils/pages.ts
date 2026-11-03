import { LISTED, pathOf } from '../../app/utils/pages'

export interface ListedPage {
  readonly collection: string
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly modified: string | null
  readonly locales: readonly string[]
  readonly noindex: boolean
  readonly order: number
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

type Reader = ReturnType<typeof useHollware>['reader']

export async function listedPages(reader: Reader, site: string): Promise<ListedPage[]> {
  const collections = ['pages', ...LISTED]
  const found = await Promise.all(
    collections.flatMap((collection) =>
      ['en', 'es'].map(async (locale) => {
        const answer = await reader
          .listEntries(site, collection, { locale, limit: 100 })
          .catch(() => null)
        return answer?.outcome === 'ok'
          ? answer.entries.map((entry) => ({ collection, locale, entry }))
          : []
      }),
    ),
  )
  const pages = new Map<string, ListedPage>()
  for (const { collection, locale, entry } of found.flat()) {
    const key = `${collection}/${entry.slug}`
    const front = entry.frontmatter
    const known = pages.get(key)
    if (known !== undefined) {
      pages.set(key, { ...known, locales: [...known.locales, locale] })
      continue
    }
    pages.set(key, {
      collection,
      slug: entry.slug,
      title: text(front['title']),
      description: text(front['description']),
      modified: entry.updatedAt ?? null,
      locales: [locale],
      noindex: front['noindex'] === true,
      order: typeof front['order'] === 'number' ? front['order'] : 99,
    })
  }
  return [...pages.values()]
    .filter((page) => page.locales.includes('en'))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'en'))
}

export const englishPath = (page: ListedPage) => pathOf(page.collection, page.slug, 'en')
