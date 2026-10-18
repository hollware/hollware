import { renderHtml, type EntryDocument } from '@hollware/core'
import type { SiteEnv } from './env.ts'
import { entryPage, listingPage, messagePage, type Alternate, type Summary } from './pages.ts'
import { blogPath, entryPath, isLocale, LOCALES, matchRoute, type Locale } from './routes.ts'

/**
 * A blog that reads Hollware over a service binding (Workers RPC): no network in between and no
 * token. The binding offers five read-only methods, and they answer with published content only,
 * so a draft is not here to leak: asking for one is asking for an entry that does not exist.
 *
 *   /blog/                    the Spanish index, newest first; ?tag=… filters and ?cursor=… pages
 *   /en/blog/                 the English index
 *   /blog/<slug>/             a published entry, rendered from its stored document
 *   /en/blog/<slug>/          the same in English; each page links its translations
 */

const COLLECTION = 'blog'

/** What an answer carries besides its body: the page is HTML and may load nothing but itself. */
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

/** The text field of an entry's frontmatter, which Hollware hands over as untyped JSON. */
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

/** The index of every locale but this one. */
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
  // A draft, an unpublished entry and a slug that never existed are the same answer.
  if (found.outcome !== 'ok' || found.entry?.document === undefined) return notFound(locale)
  const { entry } = found
  // Over RPC the document is plain JSON, typed as such. `renderHtml` takes Comark's own type and
  // checks every node it prints, whatever its type says, so this cast is the only one of the site.
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

/**
 * What an error says, for the log: Hollware's errors cross the binding with their `name`,
 * `message`, `code` and `fix`, and without their `cause`.
 */
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

/**
 * A call to Hollware failed. `invalid_input` is the visitor's: a cursor that no page of this
 * listing ever had. Anything else is the site's problem, and the visitor gets no detail of it.
 * Either way the operator finds what Hollware said, with its `fix`, in the log.
 */
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

// Not part of a site: a probe for the tests of this repository (see probe.ts).
export { Probe } from './probe.ts'
