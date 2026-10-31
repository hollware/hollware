import { schemas } from '@hollware/core'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ContentFile, Corpus } from './corpus.ts'
import { withLocalImages, type LocalImages } from './local-images.ts'

export interface NuxtContentOptions {
  readonly collection: string
  readonly locale: string
  readonly localeDirs: boolean
  readonly groupField: string
  readonly images?: { readonly found: LocalImages; readonly shown: string }
}

const BOM = String.fromCharCode(0xfeff)

const routed = (segment: string) => segment.replace(/^\d+\./, '')

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
      const raw = readFileSync(join(directory, entry.name), 'utf8')
      const imaged =
        options.images === undefined
          ? { ok: true as const, markdown: raw }
          : withLocalImages(raw, directory, options.images.found, options.images.shown)
      if (!imaged.ok) {
        problems.push({ path: where, reason: imaged.reason })
        continue
      }
      const read = imaged.markdown
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
