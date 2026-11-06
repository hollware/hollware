import { schemas } from '@hollware/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContentFile {
  path: string
  collection: string
  locale: string
  slug: string
  markdown: string
  parent?: string
}

export interface FileProblem {
  path: string
  reason: string
}

export interface Corpus {
  files: ContentFile[]
  skipped: string[]
  problems: FileProblem[]
}

export function readCorpus(root: string): Corpus {
  const corpus: Corpus = { files: [], skipped: [], problems: [] }
  walk(root, [], corpus)
  corpus.files.sort(
    (a, b) =>
      compare(a.collection, b.collection) ||
      compare(a.locale, b.locale) ||
      compareSegments(a.path.split('/'), b.path.split('/')),
  )
  corpus.skipped.sort(compare)
  corpus.problems.sort((a, b) => compare(a.path, b.path))
  return corpus
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function compareSegments(a: readonly string[], b: readonly string[]): number {
  for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
    const order = compare((a[at] ?? '').replace(/\.md$/, ''), (b[at] ?? '').replace(/\.md$/, ''))
    if (order !== 0) return order
  }
  return a.length - b.length
}

function walk(directory: string, segments: string[], corpus: Corpus): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      walk(join(directory, entry.name), [...segments, entry.name], corpus)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      readFile(join(directory, entry.name), [...segments, entry.name], corpus)
    }
  }
}

function readFile(file: string, segments: string[], corpus: Corpus): void {
  const path = segments.join('/')
  const [collection, locale, ...rest] = segments
  const name = rest.at(-1)
  if (collection === undefined || locale === undefined || name === undefined) {
    corpus.skipped.push(path)
    return
  }
  const slugs = [...rest.slice(0, -1), name.slice(0, -'.md'.length)]
  const wrong = slugs.find((one) => !schemas.slug.safeParse(one).success)
  if (wrong !== undefined) {
    corpus.problems.push({
      path,
      reason: `${JSON.stringify(wrong)} is not a slug: use lowercase letters and digits joined by hyphens, up to 200 characters.`,
    })
    return
  }
  const slug = slugs.at(-1) ?? ''
  const parent = slugs.at(-2)
  let bytes: Buffer
  try {
    bytes = readFileSync(file)
  } catch (error) {
    corpus.problems.push({
      path,
      reason: `the file cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    })
    return
  }
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    corpus.problems.push({ path, reason: 'the file is not valid UTF-8.' })
    return
  }
  corpus.files.push({
    path,
    collection,
    locale,
    slug,
    markdown,
    ...(parent === undefined ? {} : { parent }),
  })
}
