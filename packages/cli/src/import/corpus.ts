import { schemas } from '@hollware/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A Markdown file of the directory that `import` sends: `<collection>/<locale>/<slug>.md`. */
export interface ContentFile {
  /** The path below the directory, with `/`: `blog/en/edge-caching.md`. */
  path: string
  collection: string
  locale: string
  slug: string
  /** The whole file, byte order mark included: Hollware keeps it as it is. */
  markdown: string
}

/** A file that sits where an entry should but cannot be one. */
export interface FileProblem {
  path: string
  reason: string
}

export interface Corpus {
  /** The files to import, sorted by collection, locale and slug. */
  files: ContentFile[]
  /** Markdown files elsewhere in the tree, which are not entries. */
  skipped: string[]
  problems: FileProblem[]
}

/**
 * Reads the entries of a directory laid out as `<collection>/<locale>/<slug>.md`. Only `.md`
 * files count. A Markdown file at any other depth is skipped and reported; one at the right
 * depth with a slug that is not a slug, or with bytes that are not UTF-8, is a problem. Files
 * and folders whose name starts with a dot, and symbolic links, are never read: a link could
 * lead out of the directory the person pointed at.
 */
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
    // A Dirent describes the entry itself: a symbolic link is neither a file nor a directory
    // here, so it is never followed. Do not look at what it points to.
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
    // `ignoreBOM` keeps a byte order mark in the text, which is what the file holds.
    markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    corpus.problems.push({ path, reason: 'the file is not valid UTF-8.' })
    return
  }
  corpus.files.push({ path, collection, locale, slug, markdown })
}
