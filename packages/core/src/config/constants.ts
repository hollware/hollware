/** The largest Markdown file a collection accepts when its config does not say, 512 KiB. */
export const DEFAULT_MAX_MARKDOWN_BYTES = 524_288

/**
 * The largest `maxMarkdownBytes` a collection may set, 768 KiB. A revision row holds the Markdown,
 * the frontmatter and the Comark document, which is about 1.3 times the Markdown, so a row is
 * about 2.3 times the file, and the store refuses rows over 1.9 MB: a file over about 800 KB could
 * never be saved. 768 KiB keeps a margin.
 */
export const MAX_MARKDOWN_BYTES_CEILING = 786_432

/**
 * A collection name or a component name: lowercase letters, digits and hyphens, starting with a
 * letter, at most 63 characters. A component name is what Markdown writes after the colons
 * (`::callout`). A site key has its own rule (`site-key.ts`).
 */
export const NAME = /^[a-z][a-z0-9-]{0,62}$/

/**
 * The names no collection may take: the read API serves `/v1/<collection>`, and these segments
 * of `/v1/` are its other routes, which a collection of that name could never be read past
 * (`tests/conventions/reserved-collections.test.ts` keeps the list and the routes together).
 */
export const RESERVED_COLLECTION_NAMES: readonly string[] = [
  'admin',
  'assets',
  'backups',
  'ops',
  'redirects',
  'search',
  'site',
]

/** A language tag: a language, then an optional script and region: `es`, `pt-BR`, `zh-Hant-TW`. */
export const LOCALE_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/

/** The id of a contract: lowercase words joined by single hyphens. */
export const CONTRACT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The fix of a name that breaks `NAME`, with an example of the right kind. */
export function nameFix(example: string): string {
  return `Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "${example}".`
}
