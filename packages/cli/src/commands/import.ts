import {
  REFUSAL_CONTRACT_IDS,
  createDraft,
  getEntry,
  isPersonalToken,
  publish,
  schemas,
  updateDraft,
  validate,
} from '@hollware/core'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type * as z from 'zod'
import { parseFlags } from '../args.ts'
import { CliError, UsageError } from '../errors.ts'
import { printable } from '../format.ts'
import { readCorpus, type ContentFile } from '../import/corpus.ts'
import { openSession, ToolFailure, type Session } from '../import/session.ts'
import type { Io } from '../io.ts'
import { readVersion } from '../version.ts'

export const IMPORT_USAGE = [
  'Usage: hollware import <directory> --url <hollware url> (--token-file <file> | token on stdin)',
  '                       [--publish] [--dry-run]',
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
  '  --help               Show this help',
  '',
  'The token needs content:read and content:write, and content:publish for --publish: without it,',
  'publish asks for a review of one entry, and refuses a group.',
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
      help: { type: 'boolean' },
    },
  })
  if (values.help === true) {
    io.out(IMPORT_USAGE)
    return 0
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
  const token = await readToken(io, values['token-file'])
  try {
    return await importFiles({
      io,
      token,
      endpoint,
      directory,
      root,
      publish: values.publish === true,
      dryRun: values['dry-run'] === true,
    })
  } catch (error) {
    // Whatever the command says, the token is not in it: not even in a message of the server.
    if (error instanceof CliError) throw new CliError(redact(error.message, token))
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ')
    throw new CliError(
      `unexpected error: ${redact(printable(reason.slice(0, 300)), token)}. This is a bug in hollware: please report it at https://github.com/hollware/hollware/issues.`,
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
  publish: boolean
  dryRun: boolean
}

async function importFiles({
  io,
  token,
  endpoint,
  directory,
  root,
  publish: publishToo,
  dryRun,
}: Plan): Promise<number> {
  const out = (message: string): void => io.out(redact(message, token))

  const corpus = readCorpus(root)
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

  const session = await openSession(endpoint, token, readVersion())
  try {
    const checks = await validateAll(session, corpus.files)
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

    const drafts = await writeDrafts(session, corpus.files, out)
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

/** The MCP endpoint of a Hollware, from the address a person gives: `<url>/mcp`. */
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
  const path = url.pathname.replace(/\/+$/, '')
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

async function readToken(io: Io, tokenFile: string | undefined): Promise<string> {
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

/** `text` without `secret`, and without anything else that has the shape of a personal token. */
export function redact(text: string, secret: string): string {
  return text.split(secret).join('hw_pat_[redacted]').replace(TOKEN_SHAPE, 'hw_pat_[redacted]')
}

interface Check {
  file: ContentFile
  verdict: Verdict | undefined
  /** The violations that make Hollware refuse the file. */
  refusals: Violation[]
  /** Set when the call itself failed, for this file. */
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
  /** The entry as Hollware has it after the write. */
  summary: EntrySummary
}

interface Drafts {
  created: number
  updated: number
  unchanged: number
  failed: number
  /** The entries that are in Hollware now, in the order of the files. */
  entries: Imported[]
}

/**
 * Phase one: every file becomes a draft. An entry that does not exist is created; one that
 * does is updated at the version just read, which Hollware answers with `unchanged` when the
 * Markdown is the same. A failure of one file does not stop the others.
 */
async function writeDrafts(
  session: Session,
  files: readonly ContentFile[],
  out: (message: string) => void,
): Promise<Drafts> {
  const drafts: Drafts = { created: 0, updated: 0, unchanged: 0, failed: 0, entries: [] }
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
        out(draftLine(kind, label, entry, updated.verdict))
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
  /** Entries a token without content:publish asked a review for (v0.3). */
  reviews: number
  other: number
}

/** The most entries one publish takes: the entry and a group of 99 (ADR-024). */
const GROUP_SIZE = 100

/**
 * Phase two: publishes the imported entries that have unpublished changes, at the version phase
 * one left them, as one group (in groups of 100), so that entries that link to each other are
 * published together (ADR-024). When an entry stops its group, it is reported and taken out, and
 * the rest is published again without it. It acknowledges no warning: an entry with warnings is
 * reported, not published. A token without content:publish gets a review of a lone entry
 * (`pending_review`), and its group is refused, which reports every entry of it as failed.
 */
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
  for (let start = 0; start < entries.length; start += GROUP_SIZE) {
    let pending = entries.slice(start, start + GROUP_SIZE)
    while (pending.length > 0) {
      const [first, ...rest] = pending
      if (first === undefined) break
      let answer
      try {
        answer = await session.call(publish, {
          id: first.summary.id,
          version: first.summary.version,
          group: rest.map(({ summary }) => ({ id: summary.id, version: summary.version })),
        })
      } catch (error) {
        if (!(error instanceof ToolFailure)) throw error
        for (const imported of pending) out(line(imported, 'failed', [error.message]))
        result.other += pending.length
        break
      }
      if (answer.outcome === 'published' || answer.outcome === 'scheduled') {
        for (const imported of pending) out(line(imported, 'published'))
        result.published += pending.length
        break
      }
      if (answer.outcome === 'pending_review') {
        // Only one entry is ever asked for review, so pending is that entry.
        for (const imported of pending) out(line(imported, 'pending_review'))
        result.reviews += pending.length
        break
      }
      const failed = pending.find(({ summary }) => summary.id === answer.failedEntry) ?? first
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
