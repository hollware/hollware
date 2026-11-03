import type { PageEntry } from '@hollware/nuxt'
import type { PageCollection } from '../utils/pages'

export interface LoadedPage {
  readonly entry: ComputedRef<PageEntry | null>
  readonly front: ComputedRef<Record<string, unknown>>
  readonly untranslated: ComputedRef<boolean>
}

export async function usePage(
  collection: PageCollection,
  slug: MaybeRefOrGetter<string>,
  options: { readonly home?: boolean } = {},
): Promise<LoadedPage> {
  const route = useRoute()
  const { locale, m } = useLocale()
  const own = await useHollwareEntry(collection, locale.value, slug)
  const english =
    own.error.value?.statusCode === 404 && locale.value !== 'en'
      ? await useHollwareEntry(collection, 'en', slug)
      : null
  const found = english ?? own
  const error = found.error.value
  if (error) {
    failRead(
      options.home === true && error.statusCode === 404
        ? Object.assign(error, { statusCode: 503, statusMessage: m.value.pages.unavailable })
        : error,
      route.fullPath,
      m.value.pages.notFound,
    )
  }
  const entry = computed(() => found.data.value?.entry ?? null)
  return {
    entry,
    front: computed(() => entry.value?.frontmatter ?? {}),
    untranslated: computed(() => entry.value !== null && entry.value.locale !== locale.value),
  }
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)

export function usePageHead(
  collection: PageCollection,
  page: LoadedPage,
  graph: (entry: PageEntry) => readonly (Record<string, unknown> | null)[] = () => [],
): void {
  const { locale } = useLocale()
  const head = computed(() => {
    const entry = page.entry.value
    if (entry === null) return null
    const front = entry.frontmatter
    const path = pathOf(collection, entry.slug, locale.value)
    const title = text(front['seoTitle'], text(front['title'], entry.slug))
    return {
      entry,
      path,
      title,
      description: text(front['description']),
      noindex: front['noindex'] === true,
      links: linksOf({
        path: page.untranslated.value ? pathOf(collection, entry.slug, 'en') : path,
        alternates: page.untranslated.value
          ? null
          : {
              en: pathOf(collection, entry.slug, 'en'),
              es: pathOf(collection, entry.slug, 'es'),
            },
        markdown: markdownPathOf(collection, entry.slug, entry.locale),
      }),
    }
  })
  useSeoMeta({
    title: () =>
      collection === 'pages' && head.value?.entry.slug === 'home' ? '' : head.value?.title,
    description: () => head.value?.description,
    ogTitle: () => head.value?.title,
    ogDescription: () => head.value?.description,
    ogUrl: () => head.value?.links[0]?.href,
    robots: () => (head.value?.noindex ? robotsOf({ path: '', noindex: true }) : undefined),
  })
  useHead({
    link: () => {
      const links = head.value?.links ?? []
      const canonical = links
        .filter((link) => link.rel === 'canonical')
        .map((link) => ({ rel: 'canonical' as const, href: link.href }))
      const languages = links.flatMap((link) =>
        link.hreflang === undefined
          ? []
          : [{ rel: 'alternate' as const, hreflang: link.hreflang, href: link.href }],
      )
      const markdown = links.flatMap((link) =>
        link.type === undefined
          ? []
          : [{ rel: 'alternate' as const, type: link.type, href: link.href }],
      )
      return [...canonical, ...languages, ...markdown]
    },
    script: () => {
      const entry = head.value?.entry
      if (entry === undefined) return []
      return [
        { key: 'jsonld-page', type: 'application/ld+json', innerHTML: jsonLdOf(graph(entry)) },
      ]
    },
  })
}
