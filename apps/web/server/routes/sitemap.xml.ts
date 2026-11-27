import { defineEventHandler, setResponseHeader } from 'h3'
import { docLinks } from '../../app/utils/docs'
import { pathOf } from '../../app/utils/pages'
import { sitemapOf, type SitemapUrl } from '../../app/utils/seo'
import { listedPages } from '../utils/pages'

const REFERENCE = ['/reference/mcp-tools/', '/reference/read-api/', '/reference/events/']

export default defineEventHandler(async (event) => {
  const { site, reader } = useHollware(event)
  const [pages, english, spanish, docs] = await Promise.all([
    listedPages(reader, site),
    reader.getNavigation(site, 'docs', { locale: 'en' }),
    reader.getNavigation(site, 'docs', { locale: 'es' }),
    reader.listEntries(site, 'docs', { locale: 'en', limit: 100 }).catch(() => null),
  ])
  const modified = new Map(
    docs?.outcome === 'ok' ? docs.entries.map((entry) => [entry.slug, entry.updatedAt]) : [],
  )
  const translated = new Set(docLinks(spanish, 'es').map((doc) => doc.slug))
  const both = (en: string, es: string): SitemapUrl['alternates'] => ({ en, es })
  const urls: SitemapUrl[] = [
    ...pages
      .filter((page) => !page.noindex)
      .flatMap((page) => {
        const en = pathOf(page.collection, page.slug, 'en')
        const es = pathOf(page.collection, page.slug, 'es')
        const alternates = page.locales.includes('es') ? both(en, es) : null
        return [
          { path: en, modified: page.modified, alternates },
          ...(alternates === null ? [] : [{ path: es, modified: page.modified, alternates }]),
        ]
      }),
    { path: '/docs/', alternates: both('/docs/', '/es/docs/') },
    { path: '/es/docs/', alternates: both('/docs/', '/es/docs/') },
    ...docLinks(english).flatMap((doc) => {
      const en = `/docs/${doc.slug}/`
      const es = `/es/docs/${doc.slug}/`
      const alternates = translated.has(doc.slug) ? both(en, es) : null
      const day = modified.get(doc.slug) ?? null
      return [
        { path: en, modified: day, alternates },
        ...(alternates === null ? [] : [{ path: es, modified: day, alternates }]),
      ]
    }),
    ...REFERENCE.flatMap((path) => {
      const alternates = both(path, `/es${path}`)
      return [
        { path, alternates },
        { path: `/es${path}`, alternates },
      ]
    }),
  ]
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return sitemapOf(urls)
})
