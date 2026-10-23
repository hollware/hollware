/// <reference types="vite-plus/client" />

const files = import.meta.glob<string>('./content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export interface ContentFixture {
  readonly path: string
  readonly markdown: string
}

export const CONTENT_FIXTURES: readonly ContentFixture[] = Object.entries(files)
  .map(([file, markdown]) => ({ path: file.replace(/^\.\/content\//, ''), markdown }))
  .sort((a, b) => a.path.localeCompare(b.path))

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

export const BLOG_CORPUS: readonly CorpusEntry[] = CONTENT_FIXTURES.flatMap((fixture) => {
  const match = /^blog\/(en|es)\/([a-z0-9-]+)\.md$/.exec(fixture.path)
  if (match === null) return []
  const [, locale, slug] = match
  return locale === 'en' || locale === 'es'
    ? [{ collection: 'blog', locale, slug: slug ?? '', markdown: fixture.markdown }]
    : []
})
