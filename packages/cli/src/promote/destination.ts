import { Buffer } from 'node:buffer'
import { createDraft, getAsset, getEntry, unifiedDiff, updateDraft } from '@hollware/core'
import { CliError } from '../errors.ts'
import { printable } from '../format.ts'
import { ToolFailure, type Session } from '../import/session.ts'
import { uploadImages, type PendingImage } from '../commands/import.ts'
import type { SourceEntry } from './source.ts'
import { digest, type PromotedEntry } from './state.ts'

const ASSET_REFERENCE = /asset:(ast_[0-9a-f]{26})(?![0-9a-f])/g

export interface AssetCopy {
  copied: number
  present: number
  moved: Map<string, string>
}

export async function copyAssets(
  from: { session: Session; endpoint: URL; token: string },
  to: Session,
  entries: readonly SourceEntry[],
  dryRun: boolean,
): Promise<AssetCopy> {
  const ids = [
    ...new Set(
      entries.flatMap((entry) =>
        [...entry.markdown.matchAll(ASSET_REFERENCE)].map((match) => match[1] ?? ''),
      ),
    ),
  ].sort()
  const missing: string[] = []
  for (const id of ids) {
    const there = await to.call(getAsset, { id })
    if (there.outcome !== 'ok') missing.push(id)
  }
  const copy = { copied: missing.length, present: ids.length - missing.length, moved: new Map() }
  if (dryRun || missing.length === 0) return copy
  const list: PendingImage[] = []
  for (const id of missing) {
    const answer = await from.session.call(getAsset, { id })
    if (answer.outcome !== 'ok' || answer.asset === undefined) {
      throw new CliError(
        `an entry of the source shows the image ${id}, which the source does not have. Nothing was written.`,
      )
    }
    const original = new URL(`/v1/assets/${id}/original`, from.endpoint)
    const response = await fetch(original, {
      headers: { authorization: `Bearer ${from.token}` },
    })
    if (!response.ok) {
      throw new CliError(
        `could not download the image ${id} from the source (${response.status} from ${original.pathname}). Nothing was written.`,
      )
    }
    const data = Buffer.from(await response.arrayBuffer()).toString('base64')
    list.push({
      name: id,
      key: id,
      filename: answer.asset.filename,
      alt: answer.asset.alt,
      data: () => data,
    })
  }
  copy.moved = await uploadImages(to, { from: 'from the source', list }, false, () => undefined)
  return copy
}

export interface Conflict {
  diff: string
  lines: { from: number; to: number }
}

export interface Promotion {
  source: SourceEntry
  action: 'create' | 'update' | 'unchanged'
  destinationRevision: string | null
  publishedMarkdown: string | null
  conflict: boolean
  head: { id: string; version: number; markdown: string; pending: boolean } | undefined
}

export async function inspect(
  to: Session,
  source: SourceEntry,
  known: PromotedEntry | undefined,
): Promise<Promotion> {
  const where = { collection: source.collection, locale: source.locale, slug: source.slug }
  const head = await to.call(getEntry, { ...where, formats: ['markdown'] })
  if (head.outcome !== 'ok' || head.entry === undefined) {
    return {
      source,
      action: 'create',
      destinationRevision: null,
      publishedMarkdown: null,
      conflict: false,
      head: undefined,
    }
  }
  const live =
    head.entry.status === 'published'
      ? await to.call(getEntry, { ...where, formats: ['markdown'], published: true })
      : undefined
  const destinationRevision = live?.entry?.revision ?? null
  const publishedMarkdown = live?.entry?.markdown ?? null
  const conflict =
    known !== undefined &&
    destinationRevision !== known.destinationRevision &&
    digest(publishedMarkdown ?? '') !== known.promoted
  const markdown = head.entry.markdown ?? ''
  return {
    source,
    action: markdown === source.markdown ? 'unchanged' : 'update',
    destinationRevision,
    publishedMarkdown,
    conflict,
    head: {
      id: head.entry.id,
      version: head.entry.version,
      markdown,
      pending: head.entry.status === 'draft' || head.entry.hasUnpublishedChanges,
    },
  }
}

export interface Written {
  promotion: Promotion
  id: string
  version: number
  stored: string
  pending: boolean
}

export async function write(to: Session, promotion: Promotion): Promise<Written> {
  const { source, head } = promotion
  const fail = (why: string): never => {
    throw new ToolFailure(`${printable(source.path)}: ${why}`)
  }
  if (head === undefined) {
    const created = await to.call(createDraft, {
      collection: source.collection,
      locale: source.locale,
      slug: source.slug,
      markdown: source.markdown,
    })
    if (created.outcome !== 'saved' || created.entry === undefined) {
      return fail(`create_draft answered ${created.outcome}${reasons(created.verdict)}`)
    }
    return {
      promotion,
      id: created.entry.id,
      version: created.entry.version,
      stored: created.markdown ?? source.markdown,
      pending: true,
    }
  }
  if (promotion.action === 'unchanged') {
    return {
      promotion,
      id: head.id,
      version: head.version,
      stored: head.markdown,
      pending: head.pending,
    }
  }
  const updated = await to.call(updateDraft, {
    id: head.id,
    version: head.version,
    markdown: source.markdown,
  })
  if (
    (updated.outcome !== 'saved' && updated.outcome !== 'unchanged') ||
    updated.entry === undefined
  ) {
    return fail(
      updated.outcome === 'conflict'
        ? 'someone changed it in the destination while promote ran'
        : `update_draft answered ${updated.outcome}${reasons(updated.verdict)}`,
    )
  }
  return {
    promotion,
    id: updated.entry.id,
    version: updated.entry.version,
    stored: updated.markdown ?? source.markdown,
    pending: updated.entry.status === 'draft' || updated.entry.hasUnpublishedChanges,
  }
}

function reasons(verdict: { errors: { contract: string; message: string }[] } | undefined): string {
  const errors = verdict?.errors ?? []
  return errors.length === 0
    ? ''
    : `: ${errors.map((error) => printable(`[${error.contract}] ${error.message}`)).join('; ')}`
}

export function conflictOf(published: string, promoted: string): Conflict {
  const diff = unifiedDiff(published, promoted)
  const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(diff)
  const start = Number(header?.[1] ?? '1')
  const size = Number(header?.[2] ?? '1')
  const from = Math.max(1, start)
  return { diff, lines: { from, to: Math.max(from, start + size - 1) } }
}

const MAX_COMMENT = 4000

export function conflictComment(conflict: Conflict): string {
  const intro =
    'Changed in the destination since the last promotion: what is published here is not what was promoted last time. Approving this review replaces it with the promoted version.'
  const fence = '`'.repeat(
    Math.max(3, ...[...conflict.diff.matchAll(/`+/g)].map((run) => run[0].length + 1)),
  )
  const room = MAX_COMMENT - intro.length - 2 * fence.length - 20
  const lines = conflict.diff.trimEnd().split('\n')
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    if (size + line.length + 1 > room) {
      kept.push('…')
      break
    }
    kept.push(line)
    size += line.length + 1
  }
  return `${intro}\n\n${fence}diff\n${kept.join('\n')}\n${fence}`
}

export async function destinationOf(
  to: Session,
  path: string,
): Promise<{ id: string; version: number } | undefined> {
  const [collection = '', locale = '', ...rest] = path.split('/')
  const answer = await to.call(getEntry, {
    collection,
    locale,
    slug: rest.join('/'),
    formats: ['markdown'],
  })
  if (answer.outcome !== 'ok' || answer.entry === undefined) return undefined
  if (answer.entry.status !== 'published') return undefined
  return { id: answer.entry.id, version: answer.entry.version }
}
