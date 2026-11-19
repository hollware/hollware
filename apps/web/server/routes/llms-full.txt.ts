import { defineEventHandler, setResponseHeader } from 'h3'
import { docLinks } from '../../app/utils/docs'
import { ORIGIN, pathOf, withFacts } from '../../app/utils/pages'
import { listedPages } from '../utils/pages'
import { REFERENCE_PATHS, referenceMarkdownOf } from '../utils/reference'

const PRODUCT = ['home', 'features', 'compare', 'install'] as const

type Reader = ReturnType<typeof useHollware>['reader']

async function markdownOf(
  reader: Reader,
  site: string,
  collection: string,
  slug: string,
): Promise<string | null> {
  const found = await reader
    .getEntry(site, collection, slug, 'en', { formats: ['markdown'] })
    .catch(() => null)
  return found?.outcome === 'ok' && typeof found.entry?.markdown === 'string'
    ? withFacts(found.entry.markdown)
    : null
}

const section = (path: string, markdown: string | null) =>
  markdown === null ? [] : [`<!-- Source: ${ORIGIN}${path} -->`, '', markdown.trim(), '', '---', '']

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const [pages, navigation] = await Promise.all([
    listedPages(reader, site),
    reader.getNavigation(site, 'docs', { locale: 'en' }),
  ])
  const shown = pages.filter((page) => !page.noindex)
  const sources = [
    ...PRODUCT.flatMap((slug) =>
      shown.filter((page) => page.collection === 'pages' && page.slug === slug),
    ).map((page) => ({ collection: page.collection, slug: page.slug })),
    ...docLinks(navigation).map((doc) => ({ collection: 'docs', slug: doc.slug })),
    ...shown
      .filter((page) => page.collection === 'glossary')
      .map((page) => ({ collection: page.collection, slug: page.slug })),
  ]
  const bodies = await Promise.all(
    sources.map((source) => markdownOf(reader, site, source.collection, source.slug)),
  )
  const lines = [
    '# Hollware',
    '',
    `> Every page of ${ORIGIN} in English, as Markdown. The index is ${ORIGIN}/llms.txt.`,
    '',
    ...sources.flatMap((source, index) =>
      section(pathOf(source.collection, source.slug, 'en'), bodies[index] ?? null),
    ),
    ...REFERENCE_PATHS.flatMap((path) =>
      section(path.replace(/\.md$/, '/'), referenceMarkdownOf(path)),
    ),
  ]
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return lines.join('\n')
})
