import {
  REFUSAL_CONTRACT_IDS,
  createDraft,
  describeSite,
  getEntry,
  isPersonalToken,
  publish,
  schemas,
  updateDraft,
  uploadAsset,
  validate,
} from '@hollware/core'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type * as z from 'zod'
import { parseFlags } from '../args.ts'
import { CliError, UsageError } from '../errors.ts'
import { printable } from '../format.ts'
import { readCorpus, type ContentFile, type Corpus } from '../import/corpus.ts'
import {
  corpusFromNotion,
  NotionReadError,
  withCustomEmojis,
  type NotionLoader,
  type NotionOptions,
  type ReadRecords,
} from '../import/from-notion.ts'
import { corpusFromNuxtContent } from '../import/from-nuxt-content.ts'
import { openSession, ToolFailure, type Session } from '../import/session.ts'
import type { Io } from '../io.ts'
import { readVersion } from '../version.ts'

export const IMPORT_USAGE = [
  'Usage: hollware import <directory> --url <hollware url> (--token-file <file> | token on stdin)',
  '                       [--publish] [--dry-run] [--from markdown | nuxt-content]',
  '       hollware import --from notion --root <page> --collection <name> --url <hollware url>',
  '',
  'Sends the Markdown files of a directory to a running Hollware over MCP, as drafts. The files',
  'are <directory>/<collection>/<locale>/<slug>.md. Every file is validated first: if one would be',
  'refused, nothing is written. Running it again changes nothing: an entry that is already',
  'there with the same Markdown is "unchanged".',
  '',
  'Options:',
  '  --url <url>          The address of your Hollware, such as https://cms.example.com (MCP is at <url>/mcp)',
  '  --token-file <file>  A file with a personal token; without it, the token is read from stdin',
  '  --publish            Then publish the entries that have unpublished changes, acknowledging no warnings',
  '  --dry-run            Only validate: write nothing, publish nothing',
  '  --from <source>      What the directory is: markdown (the default), or the content/ of a',
  '                       Nuxt Content site; notion reads a public Notion page and its subpages',
  '  --collection <name>  nuxt-content, notion: the collection its pages go to',
  '  --locale <code>      nuxt-content, notion: the locale of every page (default en)',
  '  --locale-dirs        nuxt-content: the first folder of each page is its locale',
  '  --group-field <name> nuxt-content: the field of a translation group (default',
  '                       translationGroup)',
  '  --root <page>        notion: the id or the address of the top page',
  '  --section-field <f>  notion: the field of the title of the top page above it (default section)',
  '  --order-field <f>    notion: the field of its place among its siblings, from 1 (default order)',
  '  --callouts <mode>    notion: components (::callout, the default) or alerts (> [!NOTE])',
  '  --toggles <mode>     notion: details (::details, the default) or flatten (a bold line)',
  '  --slug-map <file>    notion: a JSON object of page id to slug, which wins over the title',
  '  --id-map <file>      notion: writes the page id to collection, locale and slug of each entry',
  '  --report <file>      notion: writes what each page lost or changed on the way',
  '  --help               Show this help',
  '',
  'The token needs content:read and content:write, and content:publish for --publish: without it,',
  'each entry asks for a review, which a person who may publish approves in the admin.',
].join('\n')

type Violation = z.output<typeof schemas.violation>
type Verdict = z.output<typeof schemas.verdict>
type EntrySummary = z.output<typeof schemas.entrySummary>

export async function importContent(argv: readonly string[], io: Io): Promise<number> {
  const { values, positionals } = parseFlags({
    args: [...argv],
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      'token-file': { type: 'string' },
      publish: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      from: { type: 'string' },
      collection: { type: 'string' },
      locale: { type: 'string' },
      'locale-dirs': { type: 'boolean' },
      'group-field': { type: 'string' },
      root: { type: 'string' },
      'section-field': { type: 'string' },
      'order-field': { type: 'string' },
      callouts: { type: 'string' },
      toggles: { type: 'string' },
      'slug-map': { type: 'string' },
      'id-map': { type: 'string' },
      report: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(IMPORT_USAGE)
    return 0
  }
  const from = values.from ?? 'markdown'
  if (from !== 'markdown' && from !== 'nuxt-content' && from !== 'notion') {
    throw new UsageError(`--from takes markdown, nuxt-content or notion, not "${printable(from)}".`)
  }
  const notionFlags = NOTION_FLAGS.filter((flag) => values[flag] !== undefined)
  if (from !== 'notion' && notionFlags.length > 0) {
    throw new UsageError(`--${notionFlags[0] ?? 'root'} is for --from notion.`)
  }
  if (from === 'notion') {
    return importNotion(io, positionals, {
      url: values.url,
      tokenFile: values['token-file'],
      root: values.root,
      collection: values.collection,
      locale: values.locale ?? 'en',
      sectionField: values['section-field'] ?? 'section',
      orderField: values['order-field'] ?? 'order',
      callouts: values.callouts ?? 'components',
      toggles: values.toggles ?? 'details',
      slugMap: values['slug-map'],
      idMap: values['id-map'],
      report: values.report,
      publish: values.publish === true,
      dryRun: values['dry-run'] === true,
    })
  }
  if (from === 'nuxt-content' && values.collection === undefined) {
    throw new UsageError('--from nuxt-content needs --collection: the collection its pages go to.')
  }
  const [directory, ...extra] = positionals
  if (directory === undefined || extra.length > 0) {
    throw new UsageError('import takes one directory: hollware import <directory> --url <url>.')
  }
  if (values.url === undefined) {
    throw new UsageError(
      '--url is required: the address of your Hollware, such as https://cms.example.com.',
    )
  }
  const endpoint = mcpEndpoint(values.url)
  const root = resolve(io.cwd, directory)
  if (!isDirectory(root)) throw new CliError(`${directory} is not a directory.`)
  const corpus = await sourceOf(from, root, {
    collection: values.collection ?? '',
    locale: values.locale ?? 'en',
    localeDirs: values['locale-dirs'] === true,
    groupField: values['group-field'] ?? 'translationGroup',
  })
  const token = await readToken(io, values['token-file'])
  try {
    return await importFiles({
      io,
      token,
      endpoint,
      directory,
      early: corpus,
      load: () => Promise.resolve({ corpus, images: manifestImages(root, directory) }),
      publish: values.publish === true,
      dryRun: values['dry-run'] === true,
    })
  } catch (error) {
    throw withoutToken(error, token)
  }
}

const NOTION_FLAGS = [
  'root',
  'section-field',
  'order-field',
  'callouts',
  'toggles',
  'slug-map',
  'id-map',
  'report',
] as const

const FIELD = /^[A-Za-z_][\w-]*$/

interface NotionFlags {
  url: string | undefined
  tokenFile: string | undefined
  root: string | undefined
  collection: string | undefined
  locale: string
  sectionField: string
  orderField: string
  callouts: string
  toggles: string
  slugMap: string | undefined
  idMap: string | undefined
  report: string | undefined
  publish: boolean
  dryRun: boolean
}

async function importNotion(
  io: Io,
  positionals: readonly string[],
  flags: NotionFlags,
): Promise<number> {
  if (positionals.length > 0) {
    throw new UsageError('--from notion takes no directory: --root names the Notion page.')
  }
  if (flags.root === undefined) {
    throw new UsageError('--from notion needs --root: the id or the address of the top page.')
  }
  if (flags.collection === undefined) {
    throw new UsageError('--from notion needs --collection: the collection its pages go to.')
  }
  if (flags.callouts !== 'components' && flags.callouts !== 'alerts') {
    throw new UsageError(
      `--callouts takes components or alerts, not "${printable(flags.callouts)}".`,
    )
  }
  if (flags.toggles !== 'details' && flags.toggles !== 'flatten') {
    throw new UsageError(`--toggles takes details or flatten, not "${printable(flags.toggles)}".`)
  }
  for (const [flag, field] of [
    ['--section-field', flags.sectionField],
    ['--order-field', flags.orderField],
  ] as const) {
    if (!FIELD.test(field) || field === 'title') {
      throw new UsageError(
        `${flag} takes the name of a frontmatter field other than title, not "${printable(field)}".`,
      )
    }
  }
  if (flags.url === undefined) {
    throw new UsageError(
      '--url is required: the address of your Hollware, such as https://cms.example.com.',
    )
  }
  const endpoint = mcpEndpoint(flags.url)
  const slugMap = flags.slugMap === undefined ? {} : readSlugMap(io, flags.slugMap)
  const { callouts, toggles, collection } = flags
  const token = await readToken(io, flags.tokenFile)
  try {
    return await importFiles({
      io,
      token,
      endpoint,
      directory: 'Notion',
      early: undefined,
      load: async (session, out) => {
        const loaded = await corpusFromNotion({
          root: flags.root ?? '',
          collection,
          locale: flags.locale,
          sectionField: flags.sectionField,
          orderField: flags.orderField,
          callouts,
          toggles,
          slugMap,
          target: await targetOf(session, collection, flags.locale),
          loader: io.notion ?? (await notionLoader()),
          download: io.download ?? ((url) => fetch(url)),
        }).catch((error: unknown) => {
          if (!(error instanceof NotionReadError)) throw error
          throw new CliError(
            `could not read the Notion page ${printable(error.pageId)}: ${printable(error.reason)}. Check --root, and that the page is shared to the web.`,
          )
        })
        if (flags.idMap !== undefined) writeJson(io, flags.idMap, loaded.ids)
        if (flags.report !== undefined) writeJson(io, flags.report, loaded.report)
        const noted = loaded.report.filter((page) => page.notes.length > 0).length
        out(
          `Read ${count(loaded.report.length, 'Notion page')}: ${noted} with notes${flags.report === undefined ? (noted === 0 ? '' : ' (--report <file> lists them)') : ` (in ${flags.report})`}, ${count(loaded.images.length, 'image')}.`,
        )
        return {
          corpus: loaded.corpus,
          images:
            loaded.images.length === 0
              ? undefined
              : {
                  from: 'from Notion',
                  list: loaded.images.map((image) => ({
                    name: image.filename,
                    key: image.key,
                    filename: image.filename,
                    alt: image.alt,
                    data: () => Buffer.from(image.bytes).toString('base64'),
                  })),
                },
        }
      },
      publish: flags.publish,
      dryRun: flags.dryRun,
    })
  } catch (error) {
    throw withoutToken(error, token)
  }
}

async function notionLoader(): Promise<NotionLoader> {
  const { NotionAPI } = await import('notion-client')
  const api = new NotionAPI()
  const read: ReadRecords = (table, ids) =>
    api.fetch({
      endpoint: 'syncRecordValuesMain',
      body: { requests: ids.map((id) => ({ table, id, version: -1 })) },
    })
  return {
    getPage: async (id) =>
      withCustomEmojis(
        await api.getPage(id, { fetchCollections: false, signFileUrls: true }),
        read,
      ),
  }
}

async function targetOf(
  session: Session,
  collection: string,
  locale: string,
): Promise<NotionOptions['target']> {
  const { site } = await session.call(describeSite, {})
  const found = site.collections.find((one) => one.name === collection)
  if (found === undefined) {
    throw new CliError(
      `the site has no collection ${printable(collection)}: it has ${site.collections.map((one) => printable(one.name)).join(', ') || 'none'}.`,
    )
  }
  return { components: found.components.map((one) => one.name), route: found.routes[locale] }
}

function readSlugMap(io: Io, file: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(resolve(io.cwd, file), 'utf8'))
  } catch (error) {
    throw new CliError(
      `could not read --slug-map ${file}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError(`--slug-map ${file} is not a JSON object of Notion page id to slug.`)
  }
  const map: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string') {
      throw new CliError(`--slug-map ${file} gives ${printable(key)} a slug that is not a string.`)
    }
    map[key] = value
  }
  return map
}

function writeJson(io: Io, file: string, value: unknown): void {
  writeFileSync(resolve(io.cwd, file), `${JSON.stringify(value, null, 2)}\n`)
}

export function withoutToken(error: unknown, token: string): CliError {
  if (error instanceof CliError) return new CliError(redact(error.message, token))
  const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ')
  return new CliError(
    `unexpected error: ${redact(printable(reason.slice(0, 300)), token)}. This is a bug in hollware: please report it at https://github.com/hollware/hollware/issues.`,
  )
}

function sourceOf(
  from: 'markdown' | 'nuxt-content',
  root: string,
  options: { collection: string; locale: string; localeDirs: boolean; groupField: string },
): Promise<Corpus> {
  return Promise.resolve(
    from === 'markdown' ? readCorpus(root) : corpusFromNuxtContent(root, options),
  )
}

interface PendingImage {
  name: string
  key: string
  filename: string
  alt: string
  data: () => string
}

interface Images {
  from: string
  list: PendingImage[]
}

interface Loaded {
  corpus: Corpus
  images: Images | undefined
}

interface Plan {
  io: Io
  token: string
  endpoint: URL
  directory: string
  early: Corpus | undefined
  load: (session: Session, out: (message: string) => void) => Promise<Loaded>
  publish: boolean
  dryRun: boolean
}

async function importFiles({
  io,
  token,
  endpoint,
  directory,
  early,
  load,
  publish: publishToo,
  dryRun,
}: Plan): Promise<number> {
  const out = (message: string): void => io.out(redact(message, token))

  if (early !== undefined) checkCorpus(early, directory, out)
  const session = await openSession(endpoint, token, readVersion())
  try {
    const { corpus, images } = await load(session, out)
    if (early === undefined) checkCorpus(corpus, directory, out)
    const moved = await uploadImages(session, images, dryRun, out)
    const files = withAssetIds(corpus.files, moved)
    const checks = await validateAll(session, files)
    if (dryRun) out(dryRunReport(checks))
    const refused = checks.filter(
      (check) => check.refusals.length > 0 || check.failure !== undefined,
    )
    if (refused.length > 0) throw new CliError(refusalReport(refused, checks.length, dryRun))
    if (dryRun) {
      out(
        `Dry run: ${count(checks.length, 'file')} validated, none would be refused. Nothing was written.`,
      )
      return 0
    }
    out(`Validated ${count(checks.length, 'file')}: none would be refused.`)

    const drafts = await writeDrafts(session, files, out, checks)
    out(
      `Drafts: ${drafts.created} created, ${drafts.updated} updated, ${drafts.unchanged} unchanged${drafts.failed === 0 ? '' : `, ${drafts.failed} failed`}.`,
    )
    if (drafts.failed > 0) {
      throw new CliError(
        `${count(drafts.failed, 'file')} could not be imported (see above).${publishToo ? ' Nothing was published.' : ''} Fix ${drafts.failed === 1 ? 'it' : 'them'} and run the import again: what is already there stays unchanged.`,
      )
    }
    if (!publishToo) return 0

    const toPublish = drafts.entries.filter((imported) => imported.summary.hasUnpublishedChanges)
    const published = await publishAll(session, toPublish, out)
    out(
      `Publishing: ${published.published} published, ${published.needsAcknowledgement} need acknowledgement, ${published.blocked} blocked${published.reviews === 0 ? '' : `, ${published.reviews} asked for review`}${published.other === 0 ? '' : `, ${published.other} failed`}.`,
    )
    const problems = published.needsAcknowledgement + published.blocked + published.other
    if (problems > 0) {
      throw new CliError(
        `${count(problems, 'entry', 'entries')} not published: warnings are never acknowledged here, and errors block publishing. Fix the content and run the import again with --publish: what is already published is skipped.`,
      )
    }
    return 0
  } finally {
    await session.close()
  }
}

function checkCorpus(corpus: Corpus, directory: string, out: (message: string) => void): void {
  if (corpus.files.length === 0 && corpus.problems.length === 0) {
    throw new CliError(
      `no entries in ${directory}: expected Markdown files at <collection>/<locale>/<slug>.md, such as blog/en/hello.md.`,
    )
  }
  if (corpus.files.length > 0) {
    out(
      `Found ${count(corpus.files.length, 'entry', 'entries')} in ${directory} (${collectionSummary(corpus.files)}).`,
    )
  }
  if (corpus.skipped.length > 0) {
    out(
      `Skipped ${count(corpus.skipped.length, 'Markdown file')} that ${corpus.skipped.length === 1 ? 'is' : 'are'} not at <collection>/<locale>/<slug>.md: ${listSome(corpus.skipped)}.`,
    )
  }
  if (corpus.problems.length > 0) {
    throw new CliError(
      [
        `${count(corpus.problems.length, 'file')} cannot be imported, so nothing was sent:`,
        ...corpus.problems.map((problem) => `  ${printable(problem.path)}: ${problem.reason}`),
        'Fix or remove them and run the import again.',
      ].join('\n'),
    )
  }
}

export function mcpEndpoint(address: string): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new UsageError(
      `invalid --url ${printable(JSON.stringify(address))}: use the address of your Hollware, such as https://cms.example.com.`,
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new UsageError(
      '--url must not hold a user name or a password: the token comes from --token-file or stdin.',
    )
  }
  if (url.search !== '' || url.hash !== '') {
    throw new UsageError('--url takes the address of Hollware only, without a query or a fragment.')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new UsageError(
      '--url must start with https://, or the token would travel unencrypted. Plain http is accepted only for localhost.',
    )
  }
  const path = withoutTrailingSlashes(url.pathname)
  url.pathname = path.endsWith('/mcp') ? path : `${path}/mcp`
  return url
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export async function readToken(io: Io, tokenFile: string | undefined): Promise<string> {
  let raw: string | undefined
  let source: string
  if (tokenFile === undefined) {
    raw = await io.readStdin()
    source = 'on stdin'
    if (raw === undefined) {
      throw new UsageError('give the token with --token-file <file>, or pipe it into stdin.')
    }
  } else {
    source = `in ${tokenFile}`
    try {
      raw = readFileSync(resolve(io.cwd, tokenFile), 'utf8')
    } catch (error) {
      throw new CliError(
        `could not read the token file ${tokenFile}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const token = raw.trim()
  if (!isPersonalToken(token)) {
    throw new CliError(
      `the token ${source} is not a Hollware personal token: it is hw_pat_ followed by 52 characters. "hollware token create" makes one.`,
    )
  }
  return token
}

const TOKEN_SHAPE = /hw_pat_[0-9a-hjkmnp-tv-z]{52}/g

export function redact(text: string, secret: string): string {
  return text.split(secret).join('hw_pat_[redacted]').replace(TOKEN_SHAPE, 'hw_pat_[redacted]')
}

interface Check {
  file: ContentFile
  verdict: Verdict | undefined
  refusals: Violation[]
  failure: string | undefined
}

async function validateAll(session: Session, files: readonly ContentFile[]): Promise<Check[]> {
  const checks: Check[] = []
  for (const file of files) {
    try {
      const answer = await session.call(validate, {
        collection: file.collection,
        locale: file.locale,
        slug: file.slug,
        markdown: file.markdown,
      })
      checks.push({
        file,
        verdict: answer.verdict,
        refusals: answer.verdict.errors.filter((violation) =>
          REFUSAL_CONTRACT_IDS.includes(violation.contract),
        ),
        failure: undefined,
      })
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error
      checks.push({ file, verdict: undefined, refusals: [], failure: error.message })
    }
  }
  return checks
}

function dryRunReport(checks: readonly Check[]): string {
  const lines: string[] = []
  for (const { file, verdict, refusals, failure } of checks) {
    const state = failure !== undefined || refusals.length > 0 ? 'refused' : 'ok'
    lines.push(`${state.padEnd(7)}  ${printable(file.path)}`)
    for (const violation of verdict?.errors ?? [])
      lines.push(`         ${violationLine(violation)}`)
    for (const violation of verdict?.warnings ?? [])
      lines.push(`         ${violationLine(violation)}`)
  }
  return lines.join('\n')
}

function refusalReport(refused: readonly Check[], total: number, dryRun: boolean): string {
  const lines = refused.flatMap(({ file, refusals, failure }) =>
    failure !== undefined
      ? [`  ${printable(file.path)}: ${failure}`]
      : refusals.map((violation) => `  ${printable(file.path)}: ${violationLine(violation)}`),
  )
  return [
    `${refused.length} of ${count(total, 'file')} would be refused, so ${dryRun ? 'a real import would write nothing' : 'nothing was written'}:`,
    ...lines,
    'Fix them and run the import again.',
  ].join('\n')
}

function violationLine(violation: Violation): string {
  const line = violation.line === undefined ? '' : ` (line ${violation.line})`
  return printable(
    `${violation.severity} [${violation.contract}] ${violation.path}${line}: ${violation.message} Fix: ${violation.fix}`,
  )
}

interface Imported {
  file: ContentFile
  summary: EntrySummary
}

interface Drafts {
  created: number
  updated: number
  unchanged: number
  failed: number
  entries: Imported[]
}

async function writeDrafts(
  session: Session,
  files: readonly ContentFile[],
  out: (message: string) => void,
  checks: readonly Check[] = [],
): Promise<Drafts> {
  const drafts: Drafts = { created: 0, updated: 0, unchanged: 0, failed: 0, entries: [] }
  const fresh = new Map(checks.map((check) => [check.file, check.verdict]))
  for (const file of files) {
    const label = printable(file.path.replace(/\.md$/, ''))
    try {
      const found = await session.call(getEntry, {
        collection: file.collection,
        locale: file.locale,
        slug: file.slug,
        formats: ['markdown'],
      })
      if (found.outcome === 'not_found' || found.entry === undefined) {
        const created = await session.call(createDraft, {
          collection: file.collection,
          locale: file.locale,
          slug: file.slug,
          markdown: file.markdown,
        })
        if (created.outcome !== 'saved' || created.entry === undefined) {
          throw new ToolFailure(`create_draft ${created.outcome}${refusalReasons(created.verdict)}`)
        }
        drafts.created += 1
        drafts.entries.push({ file, summary: created.entry })
        out(draftLine('created', label, created.entry, created.verdict))
        continue
      }
      const updated = await session.call(updateDraft, {
        id: found.entry.id,
        version: found.entry.version,
        markdown: file.markdown,
      })
      if (updated.outcome === 'conflict') {
        const current =
          updated.conflict === undefined
            ? ''
            : ` (it is at version ${updated.conflict.currentVersion} now)`
        throw new ToolFailure(
          `update_draft conflict: someone changed the entry while it was imported${current}`,
        )
      }
      if (updated.outcome === 'saved' || updated.outcome === 'unchanged') {
        const entry = updated.entry ?? found.entry
        const kind = updated.outcome === 'saved' ? 'updated' : 'unchanged'
        drafts[kind] += 1
        drafts.entries.push({ file, summary: entry })
        const verdict =
          kind === 'unchanged' ? (fresh.get(file) ?? updated.verdict) : updated.verdict
        out(draftLine(kind, label, entry, verdict))
        continue
      }
      throw new ToolFailure(`update_draft ${updated.outcome}${refusalReasons(updated.verdict)}`)
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error
      drafts.failed += 1
      out(`${'failed'.padEnd(9)}  ${label}  ${error.message}`)
    }
  }
  return drafts
}

function refusalReasons(verdict: Verdict | undefined): string {
  const reasons = (verdict?.errors ?? []).map((violation) => violationLine(violation))
  return reasons.length === 0 ? '' : `: ${reasons.join('; ')}`
}

function draftLine(
  kind: 'created' | 'updated' | 'unchanged',
  label: string,
  entry: EntrySummary,
  verdict: Verdict | undefined,
): string {
  const errors = verdict?.errors.length ?? 0
  const warnings = verdict?.warnings.length ?? 0
  const notes = [
    errors > 0 ? count(errors, 'error') : undefined,
    warnings > 0 ? count(warnings, 'warning') : undefined,
  ].filter((note) => note !== undefined)
  return `${kind.padEnd(9)}  ${label}  ${entry.id}  v${entry.version}${notes.length === 0 ? '' : ` (${notes.join(', ')})`}`
}

interface Published {
  published: number
  needsAcknowledgement: number
  blocked: number
  reviews: number
  other: number
}

const GROUP_SIZE = 100

async function publishAll(
  session: Session,
  entries: readonly Imported[],
  out: (message: string) => void,
): Promise<Published> {
  const result: Published = {
    published: 0,
    needsAcknowledgement: 0,
    blocked: 0,
    reviews: 0,
    other: 0,
  }
  const labelOf = ({ file }: Imported) => printable(file.path.replace(/\.md$/, ''))
  const line = (imported: Imported, outcome: string, details: readonly string[] = []): string =>
    [
      `${outcome.padEnd(21)}  ${labelOf(imported)}  ${imported.summary.id}`,
      ...details.map((detail) => `    ${detail}`),
    ].join('\n')
  let alone = false
  for (let start = 0; start < entries.length; start += GROUP_SIZE) {
    let pending = entries.slice(start, start + GROUP_SIZE)
    while (pending.length > 0) {
      const [first, ...rest] = pending
      if (first === undefined) break
      const batch = alone ? [first] : pending
      let answer
      try {
        answer = await session.call(publish, {
          id: first.summary.id,
          version: first.summary.version,
          ...(alone
            ? {}
            : { group: rest.map(({ summary }) => ({ id: summary.id, version: summary.version })) }),
        })
      } catch (error) {
        if (!(error instanceof ToolFailure)) throw error
        if (!alone && batch.length > 1) {
          alone = true
          continue
        }
        for (const imported of batch) out(line(imported, 'failed', [error.message]))
        result.other += batch.length
        pending = pending.filter((imported) => !batch.includes(imported))
        continue
      }
      if (answer.outcome === 'published' || answer.outcome === 'scheduled') {
        for (const imported of batch) out(line(imported, 'published'))
        result.published += batch.length
        pending = pending.filter((imported) => !batch.includes(imported))
        continue
      }
      if (answer.outcome === 'pending_review') {
        for (const imported of batch) out(line(imported, 'pending_review'))
        result.reviews += batch.length
        pending = pending.filter((imported) => !batch.includes(imported))
        continue
      }
      const failed = batch.find(({ summary }) => summary.id === answer.failedEntry) ?? first
      switch (answer.outcome) {
        case 'needs_acknowledgement':
          result.needsAcknowledgement += 1
          out(
            line(
              failed,
              'needs_acknowledgement',
              (answer.verdict?.warnings ?? []).map(violationLine),
            ),
          )
          break
        case 'blocked':
          result.blocked += 1
          out(line(failed, 'blocked', (answer.verdict?.errors ?? []).map(violationLine)))
          break
        case 'conflict':
          result.other += 1
          out(line(failed, 'conflict', ['someone changed the entry after it was imported']))
          break
        case 'not_found':
          result.other += 1
          out(line(failed, 'not_found', ['the entry is gone']))
          break
      }
      pending = pending.filter((imported) => imported !== failed)
    }
  }
  return result
}

function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

function collectionSummary(files: readonly ContentFile[]): string {
  const sizes = new Map<string, number>()
  for (const file of files) sizes.set(file.collection, (sizes.get(file.collection) ?? 0) + 1)
  return [...sizes].map(([collection, size]) => `${printable(collection)}: ${size}`).join(', ')
}

function listSome(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).map(printable)
  return paths.length > shown.length
    ? `${shown.join(', ')} and ${paths.length - shown.length} more`
    : shown.join(', ')
}

export function withAssetIds(
  files: readonly ContentFile[],
  moved: ReadonlyMap<string, string>,
): ContentFile[] {
  if (moved.size === 0) return [...files]
  return files.map((file) => ({
    ...file,
    markdown: file.markdown.replace(
      /asset:(ast_[0-9a-f]{26})(?![0-9a-f])/g,
      (whole, id: string) => {
        const now = moved.get(id)
        return now === undefined ? whole : `asset:${now}`
      },
    ),
  }))
}

function manifestImages(root: string, directory: string): Images | undefined {
  const manifestFile = join(root, '_assets', 'assets.json')
  if (!existsSync(manifestFile)) return undefined
  let manifest: Record<string, { alt?: unknown; filename?: unknown }>
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch {
    throw new CliError(`${directory}/_assets/assets.json is not JSON. Nothing was sent.`)
  }
  const list = Object.keys(manifest)
    .sort()
    .map((name): PendingImage => {
      const { alt, filename } = manifest[name] ?? {}
      if (!/^ast_[0-9a-f]{26}\.[a-z]+$/.test(name) || typeof alt !== 'string') {
        throw new CliError(
          `${directory}/_assets/assets.json names ${printable(name)} without its alt, or not as an export writes it. Nothing more was sent.`,
        )
      }
      return {
        name,
        key: name.slice(0, name.indexOf('.')),
        filename: typeof filename === 'string' && filename !== '' ? filename : name,
        alt,
        data: () => readFileSync(join(root, '_assets', name)).toString('base64'),
      }
    })
  return { from: `of ${directory}/_assets`, list }
}

async function uploadImages(
  session: Session,
  images: Images | undefined,
  dryRun: boolean,
  out: (message: string) => void,
): Promise<Map<string, string>> {
  const moved = new Map<string, string>()
  if (images === undefined) return moved
  if (dryRun) {
    out(`Would upload ${count(images.list.length, 'image')} ${images.from}.`)
    return moved
  }
  let created = 0
  let existing = 0
  for (const image of images.list) {
    const answer = await session.call(uploadAsset, {
      filename: image.filename,
      alt: image.alt,
      data: image.data(),
    })
    if (answer.outcome === 'created') created += 1
    else if (answer.outcome === 'exists') existing += 1
    else {
      throw new CliError(
        `could not upload ${printable(image.name)}: ${answer.problem?.message ?? answer.outcome} ${answer.problem?.fix ?? ''}`.trim(),
      )
    }
    if (answer.asset === undefined) {
      throw new CliError(`could not upload ${printable(image.name)}: Hollware answered no asset.`)
    }
    if (answer.asset.id !== image.key) moved.set(image.key, answer.asset.id)
  }
  out(`Images: ${created} uploaded, ${existing} already there.`)
  return moved
}

function withoutTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}
