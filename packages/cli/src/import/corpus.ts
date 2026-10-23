import { schemas } from '@hollware/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContentFile {
  path: string
  collection: string
  locale: string
  slug: string
  markdown: string
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
      compare(a.collection, b.collection) || compare(a.locale, b.locale) || compare(a.slug, b.slug),
  )
  corpus.skipped.sort(compare)
  corpus.problems.sort((a, b) => compare(a.path, b.path))
  return corpus
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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
  const [collection, locale, name] = segments
  if (
    segments.length !== 3 ||
    collection === undefined ||
    locale === undefined ||
    name === undefined
  ) {
    corpus.skipped.push(path)
    return
  }
  const slug = name.slice(0, -'.md'.length)
  if (!schemas.slug.safeParse(slug).success) {
    corpus.problems.push({
      path,
      reason: `${JSON.stringify(slug)} is not a slug: use lowercase letters and digits joined by hyphens, up to 200 characters.`,
    })
    return
  }
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
  corpus.files.push({ path, collection, locale, slug, markdown })
}
