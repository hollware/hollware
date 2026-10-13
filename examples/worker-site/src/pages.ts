import { blogPath, LOCALES, type Locale } from './routes.ts'

/**
 * The HTML of the site, as plain functions of data. Every value that came from Hollware is text of
 * an author, so it goes through `escapeHtml` on its way into a page. The one exception is the
 * body of an entry, which is HTML that `renderHtml` of @hollware/core made from the stored
 * document: it has kept out raw HTML, event handlers and unsafe URLs, whatever the document holds.
 */

const NAMES: Readonly<Record<Locale, string>> = { es: 'Español', en: 'English' }

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text as HTML text or as the value of a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

/** A link to the same content in another locale. */
export interface Alternate {
  readonly locale: Locale
  readonly href: string
}

/** What a listing shows of an entry. */
export interface Summary {
  readonly href: string
  readonly title: string
  readonly description: string
  readonly date: string
  readonly tags: readonly string[]
}

const STYLE = `body{font:1rem/1.6 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}
nav a{margin-right:1rem}
callout{display:block;margin:1rem 0;padding:.5rem 1rem;border-left:.25rem solid #888;background:#f4f4f4}
pre{overflow:auto;padding:1rem;background:#f4f4f4}
img{max-width:100%}`

function layout(
  locale: Locale,
  title: string,
  head: string,
  alternates: readonly Alternate[],
  main: string,
): string {
  const links = alternates
    .map(
      ({ locale: other, href }) =>
        `<link rel="alternate" hreflang="${other}" href="${escapeHtml(href)}">`,
    )
    .join('\n')
  const nav = LOCALES.map((candidate) =>
    candidate === locale
      ? `<a href="${blogPath(candidate)}" lang="${candidate}" aria-current="page">${NAMES[candidate]}</a>`
      : `<a href="${blogPath(candidate)}" lang="${candidate}" hreflang="${candidate}">${NAMES[candidate]}</a>`,
  ).join('\n')
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${head}${links}
<style>${STYLE}</style>
</head>
<body>
<nav aria-label="Blog">
${nav}
</nav>
<main>
${main}
</main>
</body>
</html>
`
}

function dateOf(date: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? `<time datetime="${date}">${date}</time>`
    : escapeHtml(date)
}

function summaryHtml(entry: Summary, locale: Locale): string {
  const tags = entry.tags
    .map(
      (tag) =>
        `<a href="${blogPath(locale)}?${new URLSearchParams({ tag }).toString()}">${escapeHtml(tag)}</a>`,
    )
    .join(' ')
  return `<article>
<h2><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.title)}</a></h2>
<p>${escapeHtml(entry.description)}</p>
<p>${dateOf(entry.date)}${tags === '' ? '' : ` · ${tags}`}</p>
</article>`
}

export interface ListingInput {
  readonly locale: Locale
  /** The tag the listing is filtered by, or `''` for none. */
  readonly tag: string
  readonly entries: readonly Summary[]
  /** The link to the next page, or `null` on the last one. */
  readonly nextHref: string | null
  /** The index of every other locale. */
  readonly alternates: readonly Alternate[]
}

/** The blog index: published entries, newest first, one page of them. */
export function listingPage(input: ListingInput): string {
  const { locale, tag, entries, nextHref, alternates } = input
  const heading = tag === '' ? 'Blog' : `Blog: ${tag}`
  const body =
    entries.length === 0
      ? '<p>Nothing is published here yet.</p>'
      : entries.map((entry) => summaryHtml(entry, locale)).join('\n')
  const next =
    nextHref === null ? '' : `\n<p><a rel="next" href="${escapeHtml(nextHref)}">Older posts</a></p>`
  return layout(locale, heading, '', alternates, `<h1>${escapeHtml(heading)}</h1>\n${body}${next}`)
}

export interface EntryInput {
  readonly locale: Locale
  readonly title: string
  readonly description: string
  /** HTML from `renderHtml`, printed as it is. */
  readonly body: string
  /** The same entry in the other locales that publish it. */
  readonly translations: readonly Alternate[]
}

/** One published entry. */
export function entryPage(input: EntryInput): string {
  const { locale, title, description, body, translations } = input
  const head = `<meta name="description" content="${escapeHtml(description)}">\n`
  const links =
    translations.length === 0
      ? ''
      : `\n<nav aria-label="Translations">\n${translations
          .map(
            ({ locale: other, href }) =>
              `<a href="${escapeHtml(href)}" lang="${other}" hreflang="${other}">${NAMES[other]}</a>`,
          )
          .join('\n')}\n</nav>`
  return layout(locale, title, head, translations, `<article>\n${body}\n</article>${links}`)
}

/** A page that says what happened: a 404, a 400, a 502 or a 405. The navigation leads out of it. */
export function messagePage(locale: Locale, title: string, text: string): string {
  return layout(locale, title, '', [], `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>`)
}
