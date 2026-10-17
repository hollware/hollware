import { describeSite, getEntry, listEntries, schemas } from '@hollware/core'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseFlags } from '../args.ts'
import { CliError, UsageError } from '../errors.ts'
import { printable } from '../format.ts'
import { openSession, ToolFailure, type Session } from '../import/session.ts'
import type { Io } from '../io.ts'
import { readVersion } from '../version.ts'
import { mcpEndpoint, readToken, redact, withoutToken } from './import.ts'

export const EXPORT_USAGE = [
  'Usage: hollware export <directory> --url <hollware url> (--token-file <file> | token on stdin)',
  '                       [--site <key>] [--collection <name>]... [--locale <code>]...',
  '                       [--published] [--dry-run]',
  '',
  'Writes the entries of a running Hollware, read over MCP, as Markdown files at',
  '<directory>/<collection>/<locale>/<slug>.md: the layout "hollware import" reads. Each file is',
  'the revision byte for byte as Hollware keeps it, frontmatter included, so an import of the',
  'export into the same site changes nothing. Entries in the trash are left out. The directory',
  'must be empty or not exist: nothing of yours is overwritten.',
  '',
  'Options:',
  '  --url <url>          The address of your Hollware, such as https://cms.example.com (MCP is at <url>/mcp)',
  '  --token-file <file>  A file with a personal token; without it, the token is read from stdin',
  '  --site <key>         Stop unless the token is of this site (a token reads the one site it is of)',
  '  --collection <name>  Export only this collection; repeat it for several',
  '  --locale <code>      Export only this locale; repeat it for several',
  '  --published          Export only the published entries, as they are published; by default the',
  '                       latest revision of every entry, drafts included',
  '  --dry-run            List the files it would write, and write nothing',
  '  --help               Show this help',
  '',
  'The token needs content:read.',
].join('\n')

/** The most entries one `list_entries` answers. */
const PAGE_SIZE = 100

/**
 * A folder name that is safe to write under the directory: no separator, no dot first, nothing a
 * terminal or a file system acts on. Collection names and locales are narrower than this.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

export async function exportContent(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseFlags({
    args: [...argv],
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'token-file': { type: 'string' },
      site: { type: 'string' },
      collection: { type: 'string', multiple: true },
      locale: { type: 'string', multiple: true },
      published: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(EXPORT_USAGE)
    return 0
  }
  const [directory, ...extra] = positionals
  if (directory === undefined || extra.length > 0) {
    throw new UsageError('export takes one directory: hollware export <directory> --url <url>.')
  }
  if (values.url === undefined) {
    throw new UsageError(
      '--url is required: the address of your Hollware, such as https://cms.example.com.',
    )
  }
  const endpoint = mcpEndpoint(values.url)
  const root = resolve(io.cwd, directory)
  checkTarget(root, directory)
  const token = await readToken(io, values['token-file'])
  try {
    return await exportEntries({
      io,
      token,
      endpoint,
      directory,
      root,
      site: values.site,
      collections: values.collection,
      locales: values.locale,
      published: values.published === true,
      dryRun: values['dry-run'] === true,
    })
  } catch (error) {
    throw withoutToken(error, token)
  }
}

/** The directory must be empty or not exist, so that the export overwrites nothing. */
function checkTarget(root: string, directory: string): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') return
    if (code === 'ENOTDIR') throw new CliError(`${printable(directory)} is not a directory.`)
    throw new CliError(
      `could not read ${printable(directory)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (names.length > 0) {
    throw new CliError(
      `${printable(directory)} is not empty: export into a new or an empty directory, so that no file is overwritten. Nothing was written.`,
    )
  }
}

interface Plan {
  io: Io
  token: string
  endpoint: URL
  /** The directory as the person wrote it, for the messages. */
  directory: string
  root: string
  site: string | undefined
  collections: readonly string[] | undefined
  locales: readonly string[] | undefined
  published: boolean
  dryRun: boolean
}

/** An entry to write: where, and its Markdown. */
interface ExportFile {
  collection: string
  locale: string
  slug: string
  /** `<collection>/<locale>/<slug>.md`. */
  path: string
  markdown: string
}

/**
 * Reads everything first, then writes: a call that fails stops the export before any file is
 * written.
 */
async function exportEntries(plan: Plan): Promise<number> {
  const { io, token, directory, root, published, dryRun } = plan
  const out = (message: string): void => io.out(redact(message, token))
  const session = await openSession(plan.endpoint, token, readVersion())
  let files: ExportFile[]
  let siteKey: string
  try {
    const { site } = await session.call(describeSite, {})
    siteKey = site.key
    if (plan.site !== undefined && plan.site !== site.key) {
      throw new CliError(
        `the token is of the site ${printable(JSON.stringify(site.key))}, not ${printable(JSON.stringify(plan.site))}: a personal token reads the one site it is of. Use a token of ${printable(plan.site)}.`,
      )
    }
    const collections = chosen(
      'collection',
      site.collections.map((collection) => collection.name),
      plan.collections,
    )
    const locales =
      plan.locales === undefined ? [undefined] : chosen('locale', site.locales, plan.locales)
    const listed = await listAll(session, collections, locales, published)
    files = await readAll(session, listed, published)
  } finally {
    await session.close()
  }

  const view = published ? 'the published revisions' : 'the latest revisions, drafts included'
  if (files.length === 0) {
    out(`No entries to export from the site ${printable(siteKey)} (${view}). Nothing was written.`)
    return 0
  }
  if (dryRun) {
    out(files.map((file) => `would write  ${printable(file.path)}`).join('\n'))
    out(
      `Dry run: ${count(files.length, 'entry', 'entries')} of the site ${printable(siteKey)} would be written to ${printable(directory)} (${view}):\n${groupSummary(files)}\nNothing was written.`,
    )
    return 0
  }
  let written = 0
  for (const file of files) {
    const target = join(root, file.collection, file.locale, `${file.slug}.md`)
    try {
      mkdirSync(dirname(target), { recursive: true })
      // `wx`: a file that is already there is never overwritten.
      writeFileSync(target, file.markdown, { flag: 'wx' })
    } catch (error) {
      throw new CliError(
        `could not write ${printable(file.path)}: ${error instanceof Error ? error.message : String(error)}. ${written} of ${count(files.length, 'file')} written: remove ${printable(directory)} and run the export again.`,
      )
    }
    written += 1
  }
  out(
    `Exported ${count(files.length, 'entry', 'entries')} of the site ${printable(siteKey)} to ${printable(directory)} (${view}):\n${groupSummary(files)}`,
  )
  return 0
}

/** The names asked for, each checked against what the site has; all of them when none is. */
function chosen(
  kind: 'collection' | 'locale',
  available: readonly string[],
  asked: readonly string[] | undefined,
): string[] {
  if (asked === undefined) return [...available]
  const unknown = asked.filter((name) => !available.includes(name))
  if (unknown.length > 0) {
    throw new CliError(
      `the site has no ${kind} ${unknown.map((name) => printable(JSON.stringify(name))).join(', ')}: it has ${available.map(printable).join(', ')}.`,
    )
  }
  return [...new Set(asked)]
}

interface Listed {
  collection: string
  locale: string
  slug: string
  path: string
}

/**
 * Every entry of the collections, in the locales (`undefined`: every locale), page by page.
 * The head view leaves out the trash; `published` lists only published entries. An entry whose
 * collection, locale or slug cannot be a file name below the directory stops the export.
 */
async function listAll(
  session: Session,
  collections: readonly string[],
  locales: readonly (string | undefined)[],
  published: boolean,
): Promise<Listed[]> {
  const byPath = new Map<string, Listed>()
  for (const collection of collections) {
    for (const locale of locales) {
      let cursor: string | undefined
      do {
        let page
        try {
          page = await session.call(listEntries, {
            collection,
            ...(locale === undefined ? {} : { locale }),
            ...(published ? { status: 'published' as const } : {}),
            limit: PAGE_SIZE,
            ...(cursor === undefined ? {} : { cursor }),
          })
        } catch (error) {
          if (!(error instanceof ToolFailure)) throw error
          throw new CliError(
            `could not list ${printable(locale === undefined ? collection : `${collection}/${locale}`)}: ${sentence(error.message)}. Nothing was written.`,
          )
        }
        for (const summary of page.entries) {
          const path = `${summary.collection}/${summary.locale}/${summary.slug}.md`
          if (
            !SAFE_SEGMENT.test(summary.collection) ||
            !SAFE_SEGMENT.test(summary.locale) ||
            !schemas.slug.safeParse(summary.slug).success
          ) {
            throw new CliError(
              `the server listed an entry that cannot be a file below the directory: ${printable(JSON.stringify(path))}. Nothing was written.`,
            )
          }
          byPath.set(path, {
            collection: summary.collection,
            locale: summary.locale,
            slug: summary.slug,
            path,
          })
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
    }
  }
  return [...byPath.values()].sort(
    (a, b) =>
      compare(a.collection, b.collection) || compare(a.locale, b.locale) || compare(a.slug, b.slug),
  )
}

/** The Markdown of each entry: its latest revision, or the published one. */
async function readAll(
  session: Session,
  listed: readonly Listed[],
  published: boolean,
): Promise<ExportFile[]> {
  const files: ExportFile[] = []
  for (const item of listed) {
    let answer
    try {
      answer = await session.call(getEntry, {
        collection: item.collection,
        locale: item.locale,
        slug: item.slug,
        formats: ['markdown'],
        published,
      })
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error
      throw new CliError(
        `could not read ${printable(item.path)}: ${sentence(error.message)}. Nothing was written.`,
      )
    }
    const markdown = answer.entry?.markdown
    if (answer.outcome === 'not_found' || markdown === undefined) {
      throw new CliError(
        `${printable(item.path)} is gone: it was ${published ? 'unpublished' : 'moved to the trash or renamed'} while the export ran. Nothing was written: run the export again.`,
      )
    }
    files.push({ ...item, markdown })
  }
  return files
}

function sentence(message: string): string {
  return message.replace(/[\s.]+$/, '')
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** One line per collection and locale, with how many entries: `  blog/en: 3`. */
function groupSummary(files: readonly ExportFile[]): string {
  const sizes = new Map<string, number>()
  for (const file of files) {
    const group = `${file.collection}/${file.locale}`
    sizes.set(group, (sizes.get(group) ?? 0) + 1)
  }
  return [...sizes].map(([group, size]) => `  ${printable(group)}: ${size}`).join('\n')
}
