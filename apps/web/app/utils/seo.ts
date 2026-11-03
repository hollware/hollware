import { ORIGIN, type Question } from './pages'

export interface PageHead {
  readonly path: string
  readonly alternates?: { readonly en: string; readonly es: string } | null
  readonly markdown?: string | null
  readonly noindex?: boolean
  readonly image?: string | null
}

export interface HeadLink {
  readonly rel: 'canonical' | 'alternate'
  readonly href: string
  readonly hreflang?: string
  readonly type?: 'text/markdown'
}

const absolute = (path: string) => (/^https?:\/\//.test(path) ? path : `${ORIGIN}${path}`)

export function linksOf(head: PageHead): HeadLink[] {
  const links: HeadLink[] = [{ rel: 'canonical', href: absolute(head.path) }]
  if (head.alternates) {
    links.push(
      { rel: 'alternate', hreflang: 'en', href: absolute(head.alternates.en) },
      { rel: 'alternate', hreflang: 'es', href: absolute(head.alternates.es) },
      { rel: 'alternate', hreflang: 'x-default', href: absolute(head.alternates.en) },
    )
  }
  if (head.markdown) links.push({ rel: 'alternate', type: 'text/markdown', href: head.markdown })
  return links
}

export function robotsOf(head: PageHead): string | undefined {
  return head.noindex === true ? 'noindex, follow' : undefined
}

export function imageOf(head: PageHead): string {
  return absolute(head.image ?? '/og.png')
}

const REPOSITORY = 'https://github.com/hollware/hollware'

export function organization(): Record<string, unknown> {
  return {
    '@type': 'Organization',
    '@id': `${ORIGIN}/#organization`,
    name: 'Hollware',
    url: `${ORIGIN}/`,
    logo: `${ORIGIN}/favicon.svg`,
    sameAs: [REPOSITORY],
  }
}

export function website(locale: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${ORIGIN}/#website`,
    name: 'Hollware',
    url: `${ORIGIN}/`,
    inLanguage: locale,
    publisher: { '@id': `${ORIGIN}/#organization` },
  }
}

export function softwareApplication(page: {
  readonly description: string
  readonly version: string
  readonly locale: string
}): Record<string, unknown> {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${ORIGIN}/#software`,
    name: 'Hollware',
    description: page.description,
    url: `${ORIGIN}/`,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cloudflare Workers',
    softwareVersion: page.version,
    license: 'https://opensource.org/licenses/MIT',
    codeRepository: REPOSITORY,
    inLanguage: page.locale,
    publisher: { '@id': `${ORIGIN}/#organization` },
  }
}

export function faqPage(questions: readonly Question[]): Record<string, unknown> | null {
  if (questions.length === 0) return null
  return {
    '@type': 'FAQPage',
    mainEntity: questions.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }
}

export interface Crumb {
  readonly name: string
  readonly path: string
}

export function breadcrumbs(crumbs: readonly Crumb[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  }
}

export function techArticle(page: {
  readonly title: string
  readonly description: string
  readonly path: string
  readonly locale: string
  readonly modified: string
}): Record<string, unknown> {
  return {
    '@type': 'TechArticle',
    headline: page.title,
    description: page.description,
    url: absolute(page.path),
    inLanguage: page.locale,
    dateModified: page.modified,
    publisher: { '@id': `${ORIGIN}/#organization` },
    about: { '@id': `${ORIGIN}/#software` },
  }
}

export function definedTerm(page: {
  readonly term: string
  readonly description: string
  readonly path: string
  readonly alternateNames: readonly string[]
}): Record<string, unknown> {
  return {
    '@type': 'DefinedTerm',
    name: page.term,
    description: page.description,
    url: absolute(page.path),
    ...(page.alternateNames.length === 0 ? {} : { alternateName: [...page.alternateNames] }),
  }
}

export function jsonLdOf(nodes: readonly (Record<string, unknown> | null)[]): string {
  const graph = nodes.filter((node): node is Record<string, unknown> => node !== null)
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  )
}

export interface SitemapUrl {
  readonly path: string
  readonly modified?: string | null
  readonly alternates?: { readonly en: string; readonly es: string } | null
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function sitemapOf(urls: readonly SitemapUrl[]): string {
  const body = urls.map((url) => {
    const lines = [`  <url>`, `    <loc>${escapeXml(absolute(url.path))}</loc>`]
    if (url.modified) lines.push(`    <lastmod>${escapeXml(url.modified.slice(0, 10))}</lastmod>`)
    if (url.alternates) {
      for (const [hreflang, path] of [
        ['en', url.alternates.en],
        ['es', url.alternates.es],
        ['x-default', url.alternates.en],
      ] as const) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(absolute(path))}"/>`,
        )
      }
    }
    lines.push('  </url>')
    return lines.join('\n')
  })
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...body,
    '</urlset>',
    '',
  ].join('\n')
}
