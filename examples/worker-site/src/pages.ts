import { blogPath, LOCALES, type Locale } from './routes.ts'

const NAMES: Readonly<Record<Locale, string>> = { es: 'Español', en: 'English' }

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

export interface Alternate {
  readonly locale: Locale
  readonly href: string
}

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
  readonly tag: string
  readonly entries: readonly Summary[]
  readonly nextHref: string | null
  readonly alternates: readonly Alternate[]
}

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
  readonly body: string
  readonly translations: readonly Alternate[]
}

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

export function messagePage(locale: Locale, title: string, text: string): string {
  return layout(locale, title, '', [], `<h1>${escapeHtml(title)}</h1>\n<p>${escapeHtml(text)}</p>`)
}
