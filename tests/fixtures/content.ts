/// <reference types="vite-plus/client" />

/**
 * The synthetic content the tests share, loaded through Vite (`import.meta.glob` with `?raw`), so
 * that the same import works in Node and inside workerd, which has no file system. The files
 * under `content/` are kept byte for byte: the formatter never touches them (`README.md`).
 */

const files = import.meta.glob<string>('./content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export interface ContentFixture {
  /** The path under `content/`, such as `blog/en/edge-caching-basics.md`. */
  readonly path: string
  readonly markdown: string
}

/** Every content fixture, sorted by path. */
export const CONTENT_FIXTURES: readonly ContentFixture[] = Object.entries(files)
  .map(([file, markdown]) => ({ path: file.replace(/^\.\/content\//, ''), markdown }))
  .sort((a, b) => a.path.localeCompare(b.path))

/** The Markdown of one fixture, by its path under `content/`. */
export function contentFixture(path: string): string {
  const found = CONTENT_FIXTURES.find((fixture) => fixture.path === path)
  if (found === undefined) {
    throw new Error(
      `no content fixture at ${path}; there are: ${CONTENT_FIXTURES.map((f) => f.path).join(', ')}`,
    )
  }
  return found.markdown
}

export interface CorpusEntry {
  readonly collection: 'blog'
  readonly locale: 'en' | 'es'
  readonly slug: string
  readonly markdown: string
}

/**
 * The blog corpus of the playground's config: ten entries, one in each locale for five
 * translation groups, with tags. `blog/<locale>/<slug>.md`.
 */
export const BLOG_CORPUS: readonly CorpusEntry[] = CONTENT_FIXTURES.flatMap((fixture) => {
  const match = /^blog\/(en|es)\/([a-z0-9-]+)\.md$/.exec(fixture.path)
  if (match === null) return []
  const [, locale, slug] = match
  return locale === 'en' || locale === 'es'
    ? [{ collection: 'blog', locale, slug: slug ?? '', markdown: fixture.markdown }]
    : []
})
