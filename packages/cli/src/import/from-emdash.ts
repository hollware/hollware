import { schemas } from '@hollware/core'
import type { ContentFile, Corpus } from './corpus.ts'
import { portableTextToMarkdown } from './portable-text.ts'
import { readTar } from './tar.ts'

/**
 * An EmDash site as Hollware's import reads it (`hollware import --from emdash`): a site package
 * (`.emdash`, the tar `emdash site export` writes) or a seed file (`seed.json`). Each entry that is
 * not in EmDash's trash becomes a Markdown file of `<collection>/<locale>/<slug>.md`: its first
 * Portable Text field is the body, its other fields of text, number, yes or no, date or choice are
 * the frontmatter, and its translation group is the field `groupField`. A field of another type
 * (an image, a reference, JSON, more rich text) and a block with no Markdown form are left out and
 * reported, never guessed. An entry EmDash had published is marked so, for `--publish`.
 */

type Json = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** An entry of an EmDash site, from either source. */
export interface EmdashEntry {
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly published: boolean
  readonly translationGroup: string | undefined
  readonly fields: Json
}

export interface EmdashSite {
  /** The type of each field, by collection and field slug: `portableText`, `string`, `image`… */
  readonly fieldTypes: ReadonlyMap<string, ReadonlyMap<string, string>>
  readonly entries: readonly EmdashEntry[]
}

export class EmdashError extends Error {}

/** The records of a kind in a package: every line of every chunk of `records/<kind>/`. */
function recordsOf(files: ReadonlyMap<string, Uint8Array>, kind: string): Json[] {
  const prefix = `records/${kind}/`
  return [...files]
    .filter(([path]) => path.startsWith(prefix) && path.endsWith('.ndjson'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([path, bytes]) =>
      new TextDecoder()
        .decode(bytes)
        .split('\n')
        .filter((line) => line !== '')
        .map((line, index) => {
          try {
            const record: unknown = JSON.parse(line)
            if (isObject(record)) return record
          } catch {
            // Reported below, with where it is.
          }
          throw new EmdashError(`${path}, line ${index + 1}, is not a record of JSON.`)
        }),
    )
}

/** An EmDash site package, from its archive or from the files of one already unpacked. */
export function siteFromPackage(source: Uint8Array | ReadonlyMap<string, Uint8Array>): EmdashSite {
  const files = source instanceof Uint8Array ? readTar(source) : source
  if (!files.has('manifest.json')) {
    throw new EmdashError('This is no EmDash site package: it has no manifest.json.')
  }
  const collections = new Map(
    recordsOf(files, 'collection').map((record) => [text(record['id']), text(record['slug'])]),
  )
  const fieldTypes = new Map<string, Map<string, string>>()
  for (const record of recordsOf(files, 'field')) {
    const collection = collections.get(text(record['collectionId']))
    const slug = text(record['slug'])
    const type = text(record['type'])
    if (collection === undefined || slug === undefined || type === undefined) continue
    const types = fieldTypes.get(collection) ?? new Map<string, string>()
    types.set(slug, type)
    fieldTypes.set(collection, types)
  }
  const entries = recordsOf(files, 'entry')
    .filter((record) => record['deletedAt'] === undefined)
    .map((record) => ({
      collection: text(record['collection']) ?? '',
      locale: text(record['locale']) ?? 'en',
      slug: text(record['slug']) ?? text(record['id']) ?? '',
      published: record['status'] === 'published',
      translationGroup: text(record['translationGroup']),
      fields: isObject(record['fields']) ? record['fields'] : {},
    }))
  return { fieldTypes, entries }
}

/** An EmDash seed file: its collections with their fields, and its content by collection. */
export function siteFromSeed(seed: unknown, locale = 'en'): EmdashSite {
  if (!isObject(seed) || !isObject(seed['content'])) {
    throw new EmdashError('This is no EmDash seed file: it has no "content".')
  }
  const fieldTypes = new Map<string, Map<string, string>>()
  for (const collection of Array.isArray(seed['collections']) ? seed['collections'] : []) {
    if (!isObject(collection)) continue
    const slug = text(collection['slug'])
    if (slug === undefined) continue
    fieldTypes.set(
      slug,
      new Map(
        (Array.isArray(collection['fields']) ? collection['fields'] : [])
          .filter(isObject)
          .flatMap((field) => {
            const name = text(field['slug'])
            const type = text(field['type'])
            return name === undefined || type === undefined ? [] : [[name, type] as const]
          }),
      ),
    )
  }
  const entries: EmdashEntry[] = []
  for (const [collection, items] of Object.entries(seed['content'])) {
    for (const item of Array.isArray(items) ? items : []) {
      if (!isObject(item)) continue
      entries.push({
        collection,
        locale: text(item['locale']) ?? locale,
        slug: text(item['slug']) ?? text(item['id']) ?? '',
        published: item['status'] === 'published',
        translationGroup: text(item['translationGroup']),
        fields: isObject(item['data']) ? item['data'] : {},
      })
    }
  }
  return { fieldTypes, entries }
}

/** A value of the frontmatter as YAML: strings quoted as JSON, which YAML reads as they are. */
function yamlOf(key: string, value: unknown): string | null {
  if (typeof value === 'string') return `${key}: ${JSON.stringify(value)}`
  if (typeof value === 'number' && Number.isFinite(value)) return `${key}: ${value}`
  if (typeof value === 'boolean') return `${key}: ${value}`
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.length === 0
      ? `${key}: []`
      : `${key}:\n${value.map((item) => `  - ${JSON.stringify(item)}`).join('\n')}`
  }
  return null
}

/** The field types whose values go to the frontmatter as they are. */
const SIMPLE = new Set([
  'string',
  'text',
  'slug',
  'number',
  'integer',
  'boolean',
  'datetime',
  'date',
  'select',
  'multiSelect',
])

export interface EmdashCorpus extends Corpus {
  /** The paths of the entries EmDash had published. */
  readonly published: ReadonlySet<string>
  /** What was left out, entry by entry: fields, and blocks with no Markdown form. */
  readonly leftOut: readonly { readonly path: string; readonly what: readonly string[] }[]
}

/** The corpus of an EmDash site: the files `hollware import` sends, and what it left out. */
export function corpusFromEmdash(site: EmdashSite, groupField = 'translationGroup'): EmdashCorpus {
  const files: ContentFile[] = []
  const problems: { path: string; reason: string }[] = []
  const published = new Set<string>()
  const leftOut: { path: string; what: string[] }[] = []
  for (const entry of site.entries) {
    const path = `${entry.collection}/${entry.locale}/${entry.slug}.md`
    if (!schemas.slug.safeParse(entry.slug).success) {
      problems.push({
        path,
        reason: `"${entry.slug}" is not a slug: lowercase words and digits joined by hyphens`,
      })
      continue
    }
    const types = site.fieldTypes.get(entry.collection) ?? new Map<string, string>()
    const what: string[] = []
    const lines: string[] = []
    let body = ''
    for (const [name, value] of Object.entries(entry.fields)) {
      const type = types.get(name) ?? (Array.isArray(value) ? 'portableText' : 'string')
      if (type === 'portableText' && body === '') {
        const converted = portableTextToMarkdown(value)
        body = converted.markdown
        for (const block of converted.skipped) what.push(`a ${block} block`)
        continue
      }
      const line = SIMPLE.has(type) ? yamlOf(name, value) : null
      if (line === null) what.push(`the field ${name} (${type})`)
      else lines.push(line)
    }
    if (entry.translationGroup !== undefined)
      lines.push(yamlOf(groupField, entry.translationGroup) ?? '')
    const markdown = `---\n${lines.join('\n')}\n---\n${body === '' ? '' : `\n${body}`}`
    files.push({
      path,
      collection: entry.collection,
      locale: entry.locale,
      slug: entry.slug,
      markdown,
    })
    if (entry.published) published.add(path)
    if (what.length > 0) leftOut.push({ path, what })
  }
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  files.sort((a, b) => order(a.path, b.path))
  return { files, skipped: [], problems, published, leftOut }
}
