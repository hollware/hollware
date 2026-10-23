/** The largest Markdown file a collection accepts when its config does not say, 512 KiB. */
export const DEFAULT_MAX_MARKDOWN_BYTES = 524_288

/**
 * The largest `maxMarkdownBytes` a collection may set, 768 KiB. A revision row holds the Markdown,
 * the frontmatter and the Comark document, which is about 1.3 times the Markdown, so a row is
 * about 2.3 times the file, and the store refuses rows over 1.9 MB: a file over about 800 KB could
 * never be saved. 768 KiB keeps a margin.
 */
export const MAX_MARKDOWN_BYTES_CEILING = 786_432

export const NAME = /^[a-z][a-z0-9-]{0,62}$/

export const RESERVED_COLLECTION_NAMES: readonly string[] = [
  'admin',
  'assets',
  'backups',
  'ops',
  'redirects',
  'search',
  'site',
]

export const LOCALE_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/

export const CONTRACT_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function nameFix(example: string): string {
  return `Use lowercase letters, digits and hyphens, starting with a letter, at most 63 characters, such as "${example}".`
}
