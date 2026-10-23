import { renderHtml, type EntryDocument } from '@hollware/core'
import type { SiteEnv } from './env.ts'
import { entryPage, listingPage, messagePage, type Alternate, type Summary } from './pages.ts'
import { blogPath, entryPath, isLocale, LOCALES, matchRoute, type Locale } from './routes.ts'

const COLLECTION = 'blog'

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'content-security-policy':
    "default-src 'none'; img-src 'self' https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
}

function html(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HEADERS, ...headers } })
}

function notFound(locale: Locale = 'es'): Response {
  return html(404, messagePage(locale, 'Not found', 'There is nothing at this address.'))
}

function field(frontmatter: Record<string, unknown>, key: string): string {
  const value = frontmatter[key]
  return typeof value === 'string' ? value : ''
}

function summaryOf(
  locale: Locale,
  entry: { slug: string; frontmatter: Record<string, unknown>; tags: string[] },
): Summary {
  return {
    href: entryPath(locale, entry.slug),
    title: field(entry.frontmatter, 'title'),
    description: field(entry.frontmatter, 'description'),
    date: field(entry.frontmatter, 'date'),
    tags: entry.tags,
  }
}

function otherIndexes(locale: Locale): Alternate[] {
  return LOCALES.filter((other) => other !== locale).map((other) => ({
    locale: other,
    href: blogPath(other),
  }))
}

async function blogIndex(env: SiteEnv, locale: Locale, params: URLSearchParams): Promise<Response> {
  const tag = params.get('tag') ?? ''
  const cursor = params.get('cursor') ?? ''
  const answer = await env.HOLLWARE.listEntries(env.HOLLWARE_SITE, COLLECTION, {
    locale,
    limit: env.PAGE_SIZE,
    ...(tag === '' ? {} : { tag }),
    ...(cursor === '' ? {} : { cursor }),
  })
  const next =
    answer.nextCursor === null
      ? null
      : `${blogPath(locale)}?${new URLSearchParams({ ...(tag === '' ? {} : { tag }), cursor: answer.nextCursor }).toString()}`
  return html(
    200,
    listingPage({
      locale,
      tag,
      entries: answer.entries.map((entry) => summaryOf(locale, entry)),
      nextHref: next,
      alternates: otherIndexes(locale),
    }),
  )
}

async function blogEntry(env: SiteEnv, locale: Locale, slug: string): Promise<Response> {
  const found = await env.HOLLWARE.getEntry(env.HOLLWARE_SITE, COLLECTION, slug, locale, {
    formats: ['document'],
  })
  if (found.outcome !== 'ok' || found.entry?.document === undefined) return notFound(locale)
  const { entry } = found
  const body = await renderHtml(entry.document as EntryDocument)
  const translations: Alternate[] = []
  if (entry.translationGroup !== null) {
    const group = await env.HOLLWARE.getTranslations(
      env.HOLLWARE_SITE,
      COLLECTION,
      entry.translationGroup,
    )
    for (const other of group.entries ?? []) {
      if (other.locale !== locale && isLocale(other.locale)) {
        translations.push({ locale: other.locale, href: entryPath(other.locale, other.slug) })
      }
    }
  }
  return html(
    200,
    entryPage({
      locale,
      title: field(entry.frontmatter, 'title'),
      description: field(entry.frontmatter, 'description'),
      body,
      translations,
    }),
  )
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) {
    return { name: 'unknown', message: String(error), code: null, fix: null, hasCause: false }
  }
  return {
    name: error.name,
    message: error.message,
    code: 'code' in error && typeof error.code === 'string' ? error.code : null,
    fix: 'fix' in error && typeof error.fix === 'string' ? error.fix : null,
    hasCause: error.cause !== undefined,
  }
}

function failed(locale: Locale, error: unknown): Response {
  const detail = describeError(error)
  console.log(JSON.stringify({ kind: 'hollware_error', ...detail }))
  if (detail.code === 'invalid_input') {
    return html(400, messagePage(locale, 'Bad request', 'This address is not valid.'))
  }
  return html(502, messagePage(locale, 'Unavailable', 'The blog cannot be read right now.'))
}

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return html(405, messagePage('es', 'Method not allowed', 'Use GET.'), { allow: 'GET, HEAD' })
    }
    const url = new URL(request.url)
    const route = matchRoute(url.pathname)
    if (route === null) return notFound()
    if (route.kind === 'redirect') {
      return Response.redirect(new URL(`${route.to}${url.search}`, url).href, 301)
    }
    try {
      return route.kind === 'index'
        ? await blogIndex(env, route.locale, url.searchParams)
        : await blogEntry(env, route.locale, route.slug)
    } catch (error) {
      return failed(route.locale, error)
    }
  },
} satisfies ExportedHandler<SiteEnv>

export { Probe } from './probe.ts'
