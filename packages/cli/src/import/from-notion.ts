import { schemas } from '@hollware/core'
import { createHash } from 'node:crypto'
import type { ContentFile, Corpus, FileProblem } from './corpus.ts'

export interface NotionRecordMap {
  block: Readonly<Record<string, unknown>>
  signed_urls?: Readonly<Record<string, string>>
  custom_emojis?: Readonly<Record<string, string | null>>
  notion_user?: Readonly<Record<string, unknown>>
}

export interface NotionLoader {
  getPage: (id: string) => Promise<NotionRecordMap>
}

export type Download = (url: string) => Promise<Response>

export interface NotionTarget {
  readonly components: readonly string[]
  readonly route: string | undefined
}

export interface NotionOptions {
  readonly root: string
  readonly collection: string
  readonly locale: string
  readonly sectionField: string
  readonly orderField: string
  readonly callouts: 'components' | 'alerts'
  readonly toggles: 'details' | 'flatten'
  readonly slugMap: Readonly<Record<string, string>>
  readonly target: NotionTarget
  readonly loader: NotionLoader
  readonly download: Download
}

export interface NotionImage {
  readonly key: string
  readonly filename: string
  readonly alt: string
  readonly bytes: Uint8Array
}

export interface PageReport {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly notes: string[]
}

export interface NotionImport {
  corpus: Corpus
  images: NotionImage[]
  ids: Record<string, { collection: string; locale: string; slug: string }>
  report: PageReport[]
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const CONCURRENCY = 4
const NOTION_ORIGIN = 'https://www.notion.so'
const ID_PATTERN = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/g

export function notionId(text: string): string | undefined {
  const bare = text
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
  const last = bare.match(ID_PATTERN)?.at(-1)
  if (last === undefined) return undefined
  const hex = last.replaceAll('-', '')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function compactId(id: string): string {
  return id.replaceAll('-', '')
}

export function slugOf(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 190)
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'page' : slug
}

interface Block {
  id: string
  type: string
  properties: Record<string, unknown>
  format: Record<string, unknown>
  content: string[]
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined
}

function blockOf(recordMap: NotionRecordMap, id: string): Block | undefined {
  let value = recordOf(recordOf(recordMap.block[id])?.['value'])
  if (value !== undefined && value['type'] === undefined) value = recordOf(value['value'])
  if (value === undefined || typeof value['type'] !== 'string') return undefined
  if (value['alive'] === false) return undefined
  const content = Array.isArray(value['content'])
    ? value['content'].filter((child): child is string => typeof child === 'string')
    : []
  return {
    id: typeof value['id'] === 'string' ? value['id'] : id,
    type: value['type'],
    properties: recordOf(value['properties']) ?? {},
    format: recordOf(value['format']) ?? {},
    content,
  }
}

type Segment = [string, unknown[]]

function decorations(value: unknown): Segment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Segment[] => {
    if (!Array.isArray(item) || typeof item[0] !== 'string') return []
    return [[item[0], Array.isArray(item[1]) ? item[1] : []]]
  })
}

function plainText(value: unknown): string {
  return decorations(value)
    .map(([text]) => text)
    .join('')
}

function stringAt(value: unknown, ...path: number[]): string | undefined {
  let at: unknown = value
  for (const index of path) {
    if (!Array.isArray(at)) return undefined
    at = at[index]
  }
  return typeof at === 'string' ? at : undefined
}

function titleOf(block: Block): string {
  const title = plainText(block.properties['title']).replace(/\s+/g, ' ').trim()
  return title === '' ? 'Untitled' : title
}

interface Page {
  id: string
  block: Block
  title: string
  parent: string | undefined
  position: number
  section: string
  recordMap: NotionRecordMap
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results[index] = await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const CUSTOM_EMOJI_ICON = /custom_emoji\/(?:[^/]+\/)?([0-9a-f-]{32,36})/

export function customEmojiIds(recordMap: NotionRecordMap): string[] {
  const ids = new Set<string>()
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (value[0] === 'ce' && typeof value[1] === 'string') ids.add(value[1])
    for (const item of value) visit(item)
  }
  for (const id of Object.keys(recordMap.block)) {
    const block = blockOf(recordMap, id)
    if (block === undefined) continue
    for (const property of Object.values(block.properties)) visit(property)
    const icon = block.format['page_icon']
    const emoji = typeof icon === 'string' ? CUSTOM_EMOJI_ICON.exec(icon)?.[1] : undefined
    if (emoji !== undefined) ids.add(emoji)
  }
  return [...ids].filter((id) => recordMap.custom_emojis?.[id] === undefined).sort()
}

export type ReadRecords = (table: string, ids: readonly string[]) => Promise<unknown>

export async function withCustomEmojis(
  recordMap: NotionRecordMap,
  read: ReadRecords,
): Promise<NotionRecordMap> {
  const ids = customEmojiIds(recordMap)
  if (ids.length === 0) return recordMap
  const records = recordOf(
    recordOf(recordOf(await read('custom_emoji', ids))?.['recordMap'])?.['custom_emoji'],
  )
  const found: Record<string, string | null> = { ...recordMap.custom_emojis }
  for (const id of ids) {
    let value = recordOf(recordOf(records?.[id])?.['value'])
    if (value !== undefined && typeof value['url'] !== 'string') value = recordOf(value['value'])
    const url = value?.['url']
    found[id] = typeof url === 'string' && url !== '' ? url : null
  }
  return { ...recordMap, custom_emojis: found }
}

function childPages(recordMap: NotionRecordMap, page: Block): string[] {
  const found: string[] = []
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      const block = blockOf(recordMap, id)
      if (block === undefined) continue
      if (block.type === 'page') found.push(block.id)
      else walk(block.content)
    }
  }
  walk(page.content)
  return found
}

export class NotionReadError extends Error {
  override readonly name: string = 'NotionReadError'
  readonly pageId: string
  readonly reason: string

  constructor(pageId: string, reason: string) {
    super(reason)
    this.pageId = pageId
    this.reason = reason
  }
}

async function crawl(rootId: string, loader: NotionLoader): Promise<Page[]> {
  const pages: Page[] = []
  const seen = new Set([rootId])
  let level: { id: string; parent: Page | undefined; position: number }[] = [
    { id: rootId, parent: undefined, position: 1 },
  ]
  while (level.length > 0) {
    const loaded = await mapLimit(level, CONCURRENCY, async (item) => {
      let recordMap: NotionRecordMap
      try {
        recordMap = await loader.getPage(item.id)
      } catch (error) {
        throw new NotionReadError(item.id, error instanceof Error ? error.message : String(error))
      }
      const block = blockOf(recordMap, item.id)
      if (block === undefined) throw new NotionReadError(item.id, 'Notion gave no such page')
      const title = titleOf(block)
      const section =
        item.parent === undefined || item.parent.parent === undefined ? title : item.parent.section
      return {
        id: item.id,
        block,
        title,
        parent: item.parent?.id,
        position: item.position,
        section,
        recordMap,
      }
    })
    pages.push(...loaded)
    level = loaded.flatMap((page) =>
      childPages(page.recordMap, page.block)
        .filter((id) => {
          if (seen.has(id)) return false
          seen.add(id)
          return true
        })
        .map((id, index) => ({ id, parent: page, position: index + 1 })),
    )
  }
  return pages
}

function treeOrder(pages: readonly Page[]): Page[] {
  const children = new Map<string | undefined, Page[]>()
  for (const page of pages) children.set(page.parent, [...(children.get(page.parent) ?? []), page])
  const ordered: Page[] = []
  const visit = (parent: string | undefined): void => {
    for (const page of (children.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      ordered.push(page)
      visit(page.id)
    }
  }
  visit(undefined)
  return ordered
}

function assignSlugs(
  pages: readonly Page[],
  slugMap: Readonly<Record<string, string>>,
  problems: FileProblem[],
): Map<string, string> {
  const fixed = new Map<string, string>()
  for (const [key, slug] of Object.entries(slugMap)) {
    const id = notionId(key)
    if (id === undefined) {
      problems.push({ path: `--slug-map ${key}`, reason: 'it is not the id of a Notion page.' })
      continue
    }
    if (!schemas.slug.safeParse(slug).success) {
      problems.push({
        path: `--slug-map ${key}`,
        reason: `${JSON.stringify(slug)} is not a slug: use lowercase letters and digits joined by hyphens.`,
      })
      continue
    }
    fixed.set(id, slug)
  }
  const taken = new Map<string, string>()
  for (const page of pages) {
    const slug = fixed.get(page.id)
    if (slug === undefined) continue
    const other = taken.get(slug)
    if (other !== undefined) {
      problems.push({
        path: `--slug-map ${compactId(page.id)}`,
        reason: `its slug "${slug}" is given to ${compactId(other)} too.`,
      })
      continue
    }
    taken.set(slug, page.id)
  }
  const slugs = new Map<string, string>()
  for (const page of pages) {
    const chosen = fixed.get(page.id)
    if (chosen !== undefined) {
      slugs.set(page.id, chosen)
      continue
    }
    const base = slugOf(page.title)
    let slug = base
    for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`
    taken.set(slug, page.id)
    slugs.set(page.id, slug)
  }
  return slugs
}

const ALERTS: Readonly<Record<string, string>> = {
  default: 'NOTE',
  gray: 'NOTE',
  blue: 'TIP',
  yellow: 'WARNING',
  orange: 'WARNING',
  brown: 'WARNING',
  red: 'CAUTION',
  pink: 'CAUTION',
  purple: 'IMPORTANT',
  green: 'IMPORTANT',
  teal: 'IMPORTANT',
}

export function alertOf(color: string): string {
  return ALERTS[color] ?? 'NOTE'
}

function toneOf(block: Block): string {
  const color = block.format['block_color']
  return typeof color === 'string' && color !== '' ? color.replace(/_background$/, '') : 'default'
}

const MEDIA = new Set([
  'video',
  'embed',
  'bookmark',
  'file',
  'pdf',
  'audio',
  'gist',
  'figma',
  'typeform',
  'replit',
  'codepen',
  'excalidraw',
  'tweet',
  'maps',
  'drive',
  'miro',
])

const DROPPED: Readonly<Record<string, string>> = {
  table_of_contents: 'table of contents dropped: the site builds its own',
  breadcrumb: 'breadcrumb dropped',
  collection_view: 'database dropped: databases are not imported',
  collection_view_page: 'database dropped: databases are not imported',
  button: 'button dropped',
}

function escapeText(text: string): string {
  return text
    .replace(/[\\`*_[\]<|~{]/g, '\\$&')
    .replace(
      /(^|\s)(:+)(?=[A-Za-z])/g,
      (_whole, before: string, colons: string) => `${before}${colons.replaceAll(':', '\\:')}`,
    )
}

function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6}(?:\s|$)|>)/, '$1\\$2')
    .replace(/^(\s*)([-+=](?:\s|$))/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)](?:\s|$))/, '$1$2\\$3')
}

function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? []
  const fence = '`'.repeat(Math.max(0, ...runs.map((run) => run.length)) + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

function propValue(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  if (!flat.includes('"')) return `"${flat}"`
  if (!flat.includes("'")) return `'${flat}'`
  return `"${flat.replaceAll('"', '”')}"`
}

function indent(text: string, by: number): string {
  const pad = ' '.repeat(by)
  return text
    .split('\n')
    .map((line) => (line === '' ? '' : `${pad}${line}`))
    .join('\n')
}

function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

function imageKind(bytes: Uint8Array): string | undefined {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'png'
  if (ascii(0, 4) === 'GIF8') return 'gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  if (ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'avif'
  if (/<svg[\s>]/.test(new TextDecoder().decode(bytes.slice(0, 4096)))) return 'svg'
  return undefined
}

function filenameOf(url: string, kind: string): string {
  let name = ''
  if (url.startsWith('attachment:')) name = url.slice(url.lastIndexOf(':') + 1)
  else {
    try {
      name = decodeURIComponent(new URL(url, NOTION_ORIGIN).pathname.split('/').at(-1) ?? '')
    } catch {
      name = ''
    }
  }
  name = name.replace(/[^\w.-]+/g, '-').replace(/^[-.]+/, '')
  if (!/\.[A-Za-z0-9]+$/.test(name)) name = `${name === '' ? 'image' : name}.${kind}`
  return name.slice(-200)
}

type Downloaded = { ok: true; key: string } | { ok: false; reason: string }

interface Shared {
  readonly options: NotionOptions
  readonly pages: ReadonlyMap<string, Page>
  readonly slugs: ReadonlyMap<string, string>
  readonly images: Map<string, NotionImage>
  readonly downloads: Map<string, Promise<Downloaded>>
}

class PageWriter {
  readonly notes: string[] = []
  readonly components = new Set<string>()
  private imageCount = 0

  private readonly shared: Shared
  private readonly page: Page

  constructor(shared: Shared, page: Page) {
    this.shared = shared
    this.page = page
  }

  note(text: string): void {
    if (!this.notes.includes(text)) this.notes.push(text)
  }

  private block(id: string): Block | undefined {
    return blockOf(this.page.recordMap, id)
  }

  private notionUrl(id: string): string {
    return `${NOTION_ORIGIN}/${compactId(id)}`
  }

  pageHref(id: string): string {
    const slug = this.shared.slugs.get(id)
    const { route } = this.shared.options.target
    if (slug === undefined) {
      const url = this.notionUrl(id)
      this.note(`link to a Notion page outside the import kept as ${url}`)
      return url
    }
    if (route === undefined) {
      const { collection, locale } = this.shared.options
      this.note(
        `collection ${collection} has no route for locale ${locale}: links to imported pages kept as Notion URLs`,
      )
      return this.notionUrl(id)
    }
    return route.replace(':slug', slug)
  }

  private pageTitle(id: string): string {
    const known = this.shared.pages.get(id)
    if (known !== undefined) return known.title
    const block = this.block(id)
    return block === undefined ? 'Untitled' : titleOf(block)
  }

  private linkTarget(href: string): string {
    const relative = href.startsWith('/') && !href.startsWith('//')
    let notion = relative
    if (!relative) {
      try {
        const host = new URL(href).hostname
        notion = /(^|\.)notion\.(so|site)$/.test(host)
      } catch {
        return href
      }
    }
    if (!notion) return href
    const absolute = relative ? `${NOTION_ORIGIN}${href}` : href
    const id = notionId(href)
    if (id === undefined) return absolute
    if (!this.shared.slugs.has(id)) {
      this.note(`link to a Notion page outside the import kept as ${absolute}`)
      return absolute
    }
    return this.pageHref(id)
  }

  private signed(url: string, blockId?: string): string {
    const signed = this.page.recordMap.signed_urls ?? {}
    const byBlock = blockId === undefined ? undefined : signed[blockId]
    if (byBlock !== undefined) return byBlock
    const byUrl = signed[url]
    if (byUrl !== undefined) return byUrl
    return url.startsWith('/') ? `${NOTION_ORIGIN}${url}` : url
  }

  private async fetchImage(url: string, alt: string): Promise<Downloaded> {
    const known = this.shared.downloads.get(url)
    if (known !== undefined) return known
    const pending = this.download(url, alt)
    this.shared.downloads.set(url, pending)
    return pending
  }

  private async download(url: string, alt: string): Promise<Downloaded> {
    if (url.startsWith('attachment:')) {
      return { ok: false, reason: 'Notion gave no signed address for it' }
    }
    let bytes: Uint8Array
    try {
      const response = await this.shared.options.download(url)
      if (!response.ok) {
        await response.body?.cancel()
        return { ok: false, reason: `its download answered ${response.status}` }
      }
      bytes = new Uint8Array(await response.arrayBuffer())
    } catch (error) {
      return {
        ok: false,
        reason: `its download failed (${error instanceof Error ? error.message : String(error)})`,
      }
    }
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'it is larger than 10 MB' }
    const kind = imageKind(bytes)
    if (kind === undefined) {
      return { ok: false, reason: 'it is not a JPEG, PNG, WebP, AVIF, GIF or SVG image' }
    }
    const key = `ast_${createHash('sha256').update(bytes).digest('hex').slice(0, 26)}`
    if (!this.shared.images.has(key)) {
      this.shared.images.set(key, { key, filename: filenameOf(url, kind), alt, bytes })
    }
    return { ok: true, key }
  }

  private async inline(
    value: unknown,
    mode: 'text' | 'cell' | 'heading' = 'text',
  ): Promise<string> {
    const parts: { text: string; code: boolean; marks: string; href: string | undefined }[] = []
    for (const [raw, formats] of decorations(value)) {
      let text = raw
      let code = false
      let href: string | undefined
      let literal: string | undefined
      const marks = new Set<string>()
      for (const format of formats) {
        if (!Array.isArray(format)) continue
        const [kind, argument] = format
        switch (kind) {
          case 'b':
          case 'i':
          case 's':
            marks.add(kind)
            break
          case 'c':
            code = true
            break
          case '_':
            this.note('underline dropped')
            break
          case 'h':
            this.note('text color dropped')
            break
          case 'a':
            if (typeof argument === 'string') href = this.linkTarget(argument)
            break
          case 'lm': {
            const target = typeof argument === 'string' ? argument : recordOf(argument)?.['href']
            if (typeof target === 'string') href = this.linkTarget(target)
            break
          }
          case '‣': {
            const url = stringAt(argument, 0)
            if (url !== undefined) {
              href = this.linkTarget(url)
              text = text === '‣' ? url : text
            }
            break
          }
          case 'p':
            if (typeof argument === 'string') {
              text = this.pageTitle(argument)
              href = this.pageHref(argument)
            }
            break
          case 'e':
            if (typeof argument === 'string') {
              text = argument
              code = true
              this.note('equation kept as inline code')
            }
            break
          case 'd': {
            const date = recordOf(argument)
            const start = date?.['start_date']
            const end = date?.['end_date']
            if (typeof start === 'string')
              text = typeof end === 'string' ? `${start} – ${end}` : start
            break
          }
          case 'u':
            text = this.userName(argument)
            break
          case 'ce':
            literal = await this.customEmoji(argument, text)
            break
          default:
            break
        }
      }
      if (literal !== undefined) {
        parts.push({ text: literal, code: false, marks: 'raw', href: undefined })
        continue
      }
      parts.push({ text, code, marks: [...marks].sort().join(''), href })
    }
    const merged: typeof parts = []
    for (const part of parts) {
      const last = merged.at(-1)
      if (
        last !== undefined &&
        last.marks !== 'raw' &&
        part.marks !== 'raw' &&
        last.code === part.code &&
        last.marks === part.marks &&
        last.href === part.href
      ) {
        last.text += part.text
      } else merged.push({ ...part })
    }
    const rendered = merged
      .map((part) => {
        if (part.marks === 'raw') return part.text
        const flat = mode === 'text' ? part.text : part.text.replace(/\s*\n\s*/g, ' ')
        const lead = /^\s*/.exec(flat)?.[0] ?? ''
        const trail = flat.length > lead.length ? (/\s*$/.exec(flat)?.[0] ?? '') : ''
        const core = flat.slice(lead.length, flat.length - trail.length)
        if (core === '') return flat
        let out = part.code ? codeSpan(core) : escapeText(core)
        if (part.marks.includes('s')) out = `~~${out}~~`
        if (part.marks.includes('i')) out = `_${out}_`
        if (part.marks.includes('b')) out = `**${out}**`
        if (part.href !== undefined)
          out = `[${out}](${part.href.replaceAll(' ', '%20').replaceAll(')', '%29')})`
        return `${escapeText(lead)}${out}${escapeText(trail)}`
      })
      .join('')
    if (mode !== 'text') return rendered.trim()
    return rendered
      .split(/\n\s*\n/)
      .map((paragraph) =>
        paragraph
          .split('\n')
          .map((line) => escapeLineStart(line.trim()))
          .join('\\\n'),
      )
      .filter((paragraph) => paragraph !== '')
      .join('\n\n')
  }

  private userName(argument: unknown): string {
    if (typeof argument === 'string') {
      const users = this.page.recordMap.notion_user ?? {}
      let user = recordOf(recordOf(users[argument])?.['value'])
      if (user !== undefined && user['given_name'] === undefined && user['name'] === undefined) {
        user = recordOf(user['value'])
      }
      const name = [user?.['given_name'], user?.['family_name']]
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' ')
      if (name !== '') return `@${name}`
      if (typeof user?.['name'] === 'string' && user['name'] !== '') return `@${user['name']}`
    }
    this.note('mention of a person dropped: Notion did not give the name')
    return ''
  }

  private async customEmoji(argument: unknown, text: string): Promise<string> {
    const id = typeof argument === 'string' ? argument : undefined
    const url = id === undefined ? undefined : this.page.recordMap.custom_emojis?.[id]
    const name = text.replace(/^:|:$/g, '').trim() || 'emoji'
    if (url === undefined || url === null) {
      this.note('custom emoji dropped: Notion did not give its image')
      return ''
    }
    const downloaded = await this.fetchImage(this.signed(url), name)
    if (!downloaded.ok) {
      this.note(`custom emoji dropped: ${downloaded.reason}`)
      return ''
    }
    return `![${escapeAlt(name)}](asset:${downloaded.key})`
  }

  private async iconOf(block: Block): Promise<string | undefined> {
    const icon = block.format['page_icon']
    if (typeof icon !== 'string' || icon === '') return undefined
    const emoji = CUSTOM_EMOJI_ICON.exec(icon)?.[1]
    let url: string | undefined
    if (emoji !== undefined) {
      const found = this.page.recordMap.custom_emojis?.[emoji]
      if (found === undefined || found === null) {
        this.note('callout icon dropped: Notion did not give the image of its custom emoji')
        return undefined
      }
      url = found
    } else if (/^(https?:|attachment:|\/)/.test(icon)) url = icon
    if (url === undefined) return icon
    const downloaded = await this.fetchImage(this.signed(url, block.id), 'icon')
    if (!downloaded.ok) {
      this.note(`callout icon dropped: ${downloaded.reason}`)
      return undefined
    }
    return `asset:${downloaded.key}`
  }

  async body(): Promise<string> {
    return this.children(this.page.block.content)
  }

  private async children(ids: readonly string[]): Promise<string> {
    const chunks: { text: string; list: string | undefined }[] = []
    let number = 0
    for (const id of ids) {
      const block = this.block(id)
      if (block === undefined) continue
      number = block.type === 'numbered_list' ? number + 1 : 0
      const text = await this.render(block, number)
      if (text === '') continue
      const list = ['bulleted_list', 'to_do'].includes(block.type)
        ? 'bullet'
        : block.type === 'numbered_list'
          ? 'number'
          : undefined
      chunks.push({ text, list })
    }
    let out = ''
    chunks.forEach((chunk, index) => {
      const before = chunks[index - 1]
      if (before !== undefined) {
        out += before.list !== undefined && before.list === chunk.list ? '\n' : '\n\n'
      }
      out += chunk.text
    })
    return out
  }

  private async withChildren(head: string, block: Block, by: number): Promise<string> {
    const inner = await this.children(block.content)
    if (inner === '') return head
    const first = this.block(block.content[0] ?? '')
    const tight =
      first !== undefined && ['bulleted_list', 'numbered_list', 'to_do'].includes(first.type)
    return `${head}${tight ? '\n' : '\n\n'}${indent(inner, by)}`
  }

  private async listItem(marker: string, block: Block): Promise<string> {
    const text = await this.inline(block.properties['title'])
    const head = `${marker}${indent(text, marker.length).slice(marker.length)}`
    return this.withChildren(head, block, marker.length)
  }

  private async render(block: Block, number: number): Promise<string> {
    switch (block.type) {
      case 'text': {
        const text = await this.inline(block.properties['title'])
        if (block.content.length === 0) return text
        const inner = await this.children(block.content)
        return [text, inner].filter((part) => part !== '').join('\n\n')
      }
      case 'header':
      case 'sub_header':
      case 'sub_sub_header':
      case 'header_4': {
        const depth = { header: 2, sub_header: 3, sub_sub_header: 4, header_4: 5 }[block.type]
        const text = await this.inline(block.properties['title'], 'heading')
        const heading = text === '' ? '' : `${'#'.repeat(depth)} ${text}`
        const inner = await this.children(block.content)
        return [heading, inner].filter((part) => part !== '').join('\n\n')
      }
      case 'bulleted_list':
        return this.listItem('- ', block)
      case 'numbered_list':
        return this.listItem(`${number}. `, block)
      case 'to_do': {
        const checked = /^yes$/i.test(plainText(block.properties['checked']))
        return this.listItem(checked ? '- [x] ' : '- [ ] ', block)
      }
      case 'quote': {
        const text = await this.inline(block.properties['title'])
        const inner = await this.children(block.content)
        return quoted([text, inner].filter((part) => part !== '').join('\n\n'))
      }
      case 'divider':
        return '---'
      case 'code': {
        const code = plainText(block.properties['title'])
        const language = plainText(block.properties['language']).trim().toLowerCase()
        const tag =
          language === '' || language === 'plain text' ? '' : language.replace(/\s+/g, '-')
        if (plainText(block.properties['caption']).trim() !== '') this.note('code caption dropped')
        const runs = code.match(/`{3,}/g) ?? []
        const fence = '`'.repeat(Math.max(2, ...runs.map((run) => run.length)) + 1)
        return `${fence}${tag}\n${code}\n${fence}`
      }
      case 'equation': {
        const latex = plainText(block.properties['title']).trim()
        this.note('equation kept as inline code')
        return latex === '' ? '' : codeSpan(latex)
      }
      case 'table':
        return this.table(block)
      case 'callout':
        return this.callout(block)
      case 'toggle':
        return this.toggle(block)
      case 'column_list':
      case 'column':
      case 'transclusion_container':
        return this.children(block.content)
      case 'image':
        return this.image(block)
      case 'page':
        return `[${escapeText(this.pageTitle(block.id))}](${this.pageHref(block.id)})`
      case 'alias': {
        const target = stringAt([recordOf(block.format['alias_pointer'])?.['id']], 0)
        if (target === undefined) return ''
        return `[${escapeText(this.pageTitle(target))}](${this.pageHref(target)})`
      }
      case 'external_object_instance': {
        const url = block.format['original_url']
        return typeof url === 'string' ? `[${escapeText(url)}](${url})` : ''
      }
      default:
        if (MEDIA.has(block.type)) return this.media(block)
        this.note(DROPPED[block.type] ?? `${block.type} block dropped`)
        return ''
    }
  }

  private async table(block: Block): Promise<string> {
    const rows = block.content
      .map((id) => this.block(id))
      .filter((row): row is Block => row?.type === 'table_row')
    if (rows.length === 0) return ''
    const order = block.format['table_block_column_order']
    const columns = Array.isArray(order)
      ? order.filter((column): column is string => typeof column === 'string')
      : Object.keys(rows[0]?.properties ?? {})
    if (columns.length === 0) return ''
    const cells = await Promise.all(
      rows.map(async (row) =>
        Promise.all(columns.map(async (column) => this.inline(row.properties[column], 'cell'))),
      ),
    )
    const line = (row: readonly string[]) => `| ${row.join(' | ')} |`
    const header = block.format['table_block_column_header'] === true
    if (!header) this.note('table without a header row: an empty header row was added')
    const [first = [], ...rest] = cells
    const head = header ? first : columns.map(() => '')
    const body = header ? rest : cells
    return [line(head), line(columns.map(() => '---')), ...body.map(line)].join('\n')
  }

  private async callout(block: Block): Promise<string> {
    const text = await this.inline(block.properties['title'])
    const inner = await this.children(block.content)
    const content = [text, inner].filter((part) => part !== '').join('\n\n')
    const tone = toneOf(block)
    if (this.shared.options.callouts === 'alerts') {
      if (typeof block.format['page_icon'] === 'string') this.note('callout icon dropped')
      return quoted(`[!${alertOf(tone)}]\n${content}`)
    }
    this.components.add('callout')
    const icon = await this.iconOf(block)
    const props = [icon === undefined ? '' : `icon=${propValue(icon)}`, `tone=${propValue(tone)}`]
      .filter((prop) => prop !== '')
      .join(' ')
    return `::callout{${props}}\n${content}\n::`
  }

  private async toggle(block: Block): Promise<string> {
    const summary = plainText(block.properties['title']).replace(/\s+/g, ' ').trim()
    const inner = await this.children(block.content)
    if (this.shared.options.toggles === 'flatten') {
      return [summary === '' ? '' : `**${escapeText(summary)}**`, inner]
        .filter((part) => part !== '')
        .join('\n\n')
    }
    this.components.add('details')
    return `::details{summary=${propValue(summary)}}\n${inner}\n::`
  }

  private async image(block: Block): Promise<string> {
    this.imageCount += 1
    const n = this.imageCount
    const source =
      stringAt(block.properties['source'], 0, 0) ?? stringAt([block.format['display_source']], 0)
    if (source === undefined) {
      this.note(`image ${n} dropped: it has no source`)
      return ''
    }
    const caption = plainText(block.properties['caption']).replace(/\s+/g, ' ').trim()
    const alt = (caption === '' ? `${this.page.title} (${n})` : caption).slice(0, 500)
    const downloaded = await this.fetchImage(this.signed(source, block.id), alt)
    if (!downloaded.ok) {
      this.note(`image ${n} dropped: ${downloaded.reason}`)
      return ''
    }
    return `![${escapeAlt(alt)}](asset:${downloaded.key})`
  }

  private media(block: Block): string {
    const url =
      stringAt(block.properties['source'], 0, 0) ??
      stringAt(block.properties['link'], 0, 0) ??
      stringAt([block.format['display_source']], 0)
    if (url === undefined) {
      this.note(`${block.type} dropped: it has no address`)
      return ''
    }
    const address = this.signed(url, block.id)
    if (address !== url || url.startsWith('attachment:')) {
      this.note(`${block.type} is a file kept by Notion: its link expires`)
    }
    if (this.shared.options.target.components.includes('embed')) {
      this.components.add('embed')
      return `::embed{url=${propValue(address)}}\n::`
    }
    this.note(`${block.type} kept as a link: the collection declares no embed component`)
    const label =
      plainText(block.properties['title']).trim() ||
      plainText(block.properties['caption']).trim() ||
      address
    return `[${escapeText(label)}](${address})`
  }
}

function escapeAlt(text: string): string {
  return text.replace(/[\\[\]]/g, '\\$&')
}

function frontmatter(fields: readonly (readonly [string, string | number])[]): string {
  const lines = fields.map(
    ([key, value]) =>
      `${key}: ${typeof value === 'number' ? String(value) : JSON.stringify(value)}`,
  )
  return `---\n${lines.join('\n')}\n---\n`
}

const FIXES: Readonly<Record<string, string>> = {
  callout: 'declare callout in its components, or use --callouts alerts',
  details: 'declare details in its components, or use --toggles flatten',
  embed: 'declare embed in its components',
}

export async function corpusFromNotion(options: NotionOptions): Promise<NotionImport> {
  const rootId = notionId(options.root)
  if (rootId === undefined) throw new NotionReadError(options.root, 'it is not a Notion page id')
  const pages = treeOrder(await crawl(rootId, options.loader))
  const problems: FileProblem[] = []
  const slugs = assignSlugs(pages, options.slugMap, problems)
  const shared: Shared = {
    options,
    pages: new Map(pages.map((page) => [page.id, page])),
    slugs,
    images: new Map(),
    downloads: new Map(),
  }
  const written = await mapLimit(pages, CONCURRENCY, async (page) => {
    const writer = new PageWriter(shared, page)
    const body = await writer.body()
    return { page, writer, body }
  })
  const files: ContentFile[] = []
  const ids: NotionImport['ids'] = {}
  const report: PageReport[] = []
  for (const { page, writer, body } of written) {
    const slug = slugs.get(page.id) ?? slugOf(page.title)
    const path = `${options.collection}/${options.locale}/${slug}.md`
    const head = frontmatter([
      ['title', page.title],
      [options.sectionField, page.section],
      [options.orderField, page.position],
    ])
    files.push({
      path,
      collection: options.collection,
      locale: options.locale,
      slug,
      markdown: body === '' ? head : `${head}\n${body}\n`,
    })
    for (const component of [...writer.components].sort()) {
      if (options.target.components.includes(component)) continue
      problems.push({
        path,
        reason: `it uses the component ${component}, which collection ${options.collection} does not declare: ${FIXES[component] ?? `declare ${component} in its components`}.`,
      })
    }
    ids[compactId(page.id)] = { collection: options.collection, locale: options.locale, slug }
    report.push({ id: compactId(page.id), title: page.title, slug, notes: writer.notes })
  }
  return {
    corpus: { files, skipped: [], problems },
    images: [...shared.images.values()],
    ids,
    report,
  }
}
