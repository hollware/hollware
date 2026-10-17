import { schemas } from '@hollware/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentFile, Corpus } from './corpus.ts'

/**
 * The `content/` of a Nuxt Content site as Hollware's import reads it (`hollware import --from
 * nuxt-content`). Its pages are Markdown with MDC components, which Comark reads as they are, so
 * a file is imported byte for byte, but for a `title` it lacks: Nuxt Content takes a page's title
 * from its first heading, and Hollware reads it from the frontmatter, so it is written there, from
 * that heading or else the slug. Its path becomes the slug as Nuxt Content routes it: the
 * numeric prefixes that order files go (`1.guide/2.install.md` is `guide-install`), an `index.md`
 * is its folder, and the folders join with hyphens. With `localeDirs`, the first folder is the
 * locale (`content/en/…`, `content/es/…`), and the pages at the same path in each locale are one
 * translation group, written in the field `groupField` when the page has none. Partials (`_`),
 * hidden files and links are never read; data files (YAML, JSON, CSV) are skipped and reported.
 */

export interface NuxtContentOptions {
  readonly collection: string
  /** The locale of every page, when the folders do not say it. */
  readonly locale: string
  /** Whether the first folder of each page is its locale. */
  readonly localeDirs: boolean
  readonly groupField: string
}

/** The byte order mark a file may start with, kept where it is. */
const BOM = String.fromCharCode(0xfeff)

/** A segment of a path as Nuxt Content routes it: its numeric prefix gone. */
const routed = (segment: string) => segment.replace(/^\d+\./, '')

/** The frontmatter of `markdown` with `field` set to `value`, unless the page sets it already. */
function withField(markdown: string, field: string, value: string): string {
  const line = `${field}: ${JSON.stringify(value)}`
  const bom = markdown.startsWith(BOM) ? BOM : ''
  const body = markdown.slice(bom.length)
  const open = /^---\r?\n/.exec(body)
  if (open === null) return `${bom}---\n${line}\n---\n\n${body}`
  const close = /^---\s*$/m.exec(body.slice(open[0].length))
  if (close === null) return markdown
  const frontmatter = body.slice(open[0].length, open[0].length + close.index)
  if (new RegExp(`^${field}\\s*:`, 'm').test(frontmatter)) return markdown
  const at = open[0].length + close.index
  return `${bom}${body.slice(0, at)}${line}\n${body.slice(at)}`
}

export function corpusFromNuxtContent(root: string, options: NuxtContentOptions): Corpus {
  const files: ContentFile[] = []
  const skipped: string[] = []
  const problems: { path: string; reason: string }[] = []
  const bySlug = new Map<string, string>()

  const walk = (directory: string, segments: string[]) => {
    // In name order, so which of two pages that share a slug is kept never depends on the disk.
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      const path = [...segments, entry.name]
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), path)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.endsWith('.md')) {
        skipped.push(path.join('/'))
        continue
      }
      const [first, ...rest] = path
      const locale = options.localeDirs ? (first ?? '') : options.locale
      const below = options.localeDirs ? rest : path
      if (options.localeDirs && rest.length === 0) {
        skipped.push(path.join('/'))
        continue
      }
      const route = below.map(routed)
      route[route.length - 1] = (route.at(-1) ?? '').slice(0, -'.md'.length)
      if (route.length > 1 && route.at(-1) === 'index') route.pop()
      const slug = route.join('-')
      const where = path.join('/')
      if (!schemas.slug.safeParse(slug).success) {
        problems.push({ path: where, reason: `its route makes "${slug}", which is not a slug` })
        continue
      }
      const key = `${locale}/${slug}`
      const other = bySlug.get(key)
      if (other !== undefined) {
        problems.push({ path: where, reason: `its slug "${slug}" is the slug of ${other} too` })
        continue
      }
      bySlug.set(key, where)
      const read = readFileSync(join(directory, entry.name), 'utf8')
      const heading = /^#[ \t]+(.+?)[ \t]*$/m.exec(read)?.[1]
      const text = withField(read, 'title', heading ?? slug)
      files.push({
        path: `${options.collection}/${locale}/${slug}.md`,
        collection: options.collection,
        locale,
        slug,
        markdown: options.localeDirs ? withField(text, options.groupField, slug) : text,
      })
    }
  }
  walk(root, [])
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  files.sort((a, b) => order(a.path, b.path))
  return {
    files,
    skipped: skipped.sort(order),
    problems: problems.sort((a, b) => order(a.path, b.path)),
  }
}
