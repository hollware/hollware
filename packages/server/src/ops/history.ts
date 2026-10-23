import type { OperationByName } from '@hollware/core'
import type * as z from 'zod'
import type { HistoryRevision, StoredEntry } from '../ports.ts'
import { cursorOf, parseCursor } from './assets.ts'
import type { OperationHandler } from './types.ts'
import { updateDraft } from './update-draft.ts'

type RevisionView = NonNullable<
  z.output<OperationByName<'list_revisions'>['output']>['revisions']
>[number]

function clientOf(meta: HistoryRevision['actorMeta']): string | null {
  const name = meta?.['name']
  if (typeof name !== 'string') return null
  const version = meta?.['version']
  return typeof version === 'string' ? `${name} ${version}` : name
}

function revisionView(revision: HistoryRevision, entry: StoredEntry): RevisionView {
  const title = revision.frontmatter['title']
  return {
    id: revision.id,
    entryId: revision.entryId,
    createdAt: revision.createdAt,
    author: revision.actorUserId,
    authorName: revision.authorName,
    via: revision.actorKind,
    client: clientOf(revision.actorMeta),
    title: typeof title === 'string' ? title : null,
    wordCount: revision.wordCount,
    errors: revision.verdict.errors.length,
    warnings: revision.verdict.warnings.length,
    head: entry.headRevision === revision.id,
    live: entry.publishedRevision === revision.id,
    published: revision.published,
  }
}

export const listRevisions: OperationHandler<'list_revisions'> = async (input, context) => {
  const found = await context.store.findEntryById(context.site.key, input.id, 'head')
  if (found === null) return { outcome: 'not_found' }
  const rows = await context.store.listRevisions(
    context.site.key,
    input.id,
    input.limit + 1,
    parseCursor(input.cursor),
  )
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    outcome: 'ok',
    revisions: page.map((revision) => revisionView(revision, found.entry)),
    nextCursor: rows.length > input.limit && last !== undefined ? cursorOf(last) : null,
  }
}

export const getRevision: OperationHandler<'get_revision'> = async (input, context) => {
  const revision = await context.store.findRevision(context.site.key, input.id)
  if (revision === null) return { outcome: 'not_found' }
  const found = await context.store.findEntryById(context.site.key, revision.entryId, 'head')
  if (found === null) return { outcome: 'not_found' }
  return {
    outcome: 'ok',
    revision: { ...revisionView(revision, found.entry), markdown: revision.markdown },
  }
}

export const restoreRevision: OperationHandler<'restore_revision'> = async (input, context) => {
  const revision = await context.store.findRevision(context.site.key, input.revision)
  if (revision === null || revision.entryId !== input.id) return { outcome: 'not_found' }
  return updateDraft({ id: input.id, version: input.version, markdown: revision.markdown }, context)
}
