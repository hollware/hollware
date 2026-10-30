import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import * as z from 'zod'
import { CliError } from '../errors.ts'
import { printable } from '../format.ts'

const promotedEntry = z.strictObject({
  sourceEntry: z.string(),
  sourceRevision: z.string(),
  destinationRevision: z.string().nullable(),
  promoted: z.string(),
  unpublish: z.literal(true).optional(),
})

const promoteState = z.strictObject({
  version: z.literal(1),
  from: z.string(),
  to: z.string(),
  cursors: z.record(z.string(), z.string()),
  entries: z.record(z.string(), promotedEntry),
  reviews: z.array(z.string()),
})

export type PromotedEntry = z.output<typeof promotedEntry>
export type PromoteState = z.output<typeof promoteState>

export function emptyState(from: URL, to: URL): PromoteState {
  return { version: 1, from: from.origin, to: to.origin, cursors: {}, entries: {}, reviews: [] }
}

export function defaultStatePath(from: URL, to: URL): string {
  const host = (url: URL) => url.host.replace(/[^A-Za-z0-9.-]/g, '_')
  return join('.hollware', `promote-${host(from)}-${host(to)}.json`)
}

export function readState(path: string, shown: string, from: URL, to: URL): PromoteState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return emptyState(from, to)
    }
    throw new CliError(
      `could not read the state ${printable(shown)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined
  }
  const state = promoteState.safeParse(parsed)
  if (!state.success) {
    throw new CliError(
      `the state ${printable(shown)} is not one promote wrote. Move it away to promote everything again with --all.`,
    )
  }
  if (state.data.from !== from.origin || state.data.to !== to.origin) {
    throw new CliError(
      `the state ${printable(shown)} is of ${printable(state.data.from)} to ${printable(state.data.to)}, not of ${from.origin} to ${to.origin}: give each pair of instances its own --state.`,
    )
  }
  return state.data
}

export function writeState(path: string, state: PromoteState): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
}

export function scopeOf(collection: string, locale: string | undefined, tag: string | undefined) {
  return `${collection}${locale === undefined ? '' : `/${locale}`}${tag === undefined ? '' : `#${tag}`}`
}

export function digest(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex')
}
