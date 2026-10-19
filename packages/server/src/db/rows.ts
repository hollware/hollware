import type { AcknowledgedWarning, EntryDocument, Verdict } from '@hollware/core'
import { and, eq, sql, type SQL } from 'drizzle-orm'

import type {
  Actor,
  RevisionSummary,
  StoredEntry,
  StoredPublication,
  StoredRevision,
} from '../ports.ts'
import { entries, publications, revisions, revisionTags } from './schema.ts'

/**
 * The columns the store reads and how they become the types of `ports.ts`. The JSON columns come
 * back as the store wrote them: the `CHECK`s of the schema guarantee valid JSON, and only the
 * store writes the shapes.
 */

/** The columns of `entries` that `StoredEntry` holds. */
export const entryFields = {
  id: entries.id,
  collection: entries.collection,
  locale: entries.locale,
  slug: entries.slug,
  translationGroup: entries.translationGroup,
  status: entries.status,
  version: entries.version,
  headRev: entries.headRev,
  publishedRev: entries.publishedRev,
  publishedAt: entries.publishedAt,
  scheduledAt: entries.scheduledAt,
  deletedAt: entries.deletedAt,
  updatedAt: entries.updatedAt,
}

/** The columns of `revisions` that `StoredRevision` holds, except its tags. */
export const revisionFields = {
  id: revisions.id,
  entryId: revisions.entryId,
  markdown: revisions.markdown,
  frontmatter: revisions.frontmatter,
  document: revisions.document,
  comarkVersion: revisions.comarkVersion,
  pipelineVersion: revisions.pipelineVersion,
  wordCount: revisions.wordCount,
  codeWords: revisions.codeWords,
  verdict: revisions.verdict,
  actorKind: revisions.actorKind,
  actorUserId: revisions.actorUserId,
  actorTokenId: revisions.actorTokenId,
  actorMeta: revisions.actorMeta,
  createdAt: revisions.createdAt,
}

/**
 * The columns of `revisions` that a listing reads: the id and the frontmatter of the revision of
 * the view, and nothing else. The Markdown, the document and the verdict can weigh megabytes, so
 * a listing never selects them (`tests/db/list.workerd.test.ts` holds the statements to it).
 */
export const revisionSummaryFields = {
  id: revisions.id,
  frontmatter: revisions.frontmatter,
  wordCount: revisions.wordCount,
  codeWords: revisions.codeWords,
  createdAt: revisions.createdAt,
}

/** The columns of `publications` that `StoredPublication` holds. */
export const publicationFields = {
  id: publications.id,
  entryId: publications.entryId,
  action: publications.action,
  revisionId: publications.revisionId,
  verdict: publications.verdict,
  acknowledged: publications.acknowledged,
  actorKind: publications.actorKind,
  actorUserId: publications.actorUserId,
  actorTokenId: publications.actorTokenId,
  actorMeta: publications.actorMeta,
  createdAt: publications.createdAt,
}

/**
 * The tags of a revision as a JSON array, read in the same statement as the revision: one query
 * per page, and the same snapshot. `revision` is the revision table the statement joins.
 */
export function tagsOf(revision: typeof revisions): SQL<string> {
  return sql<string>`(select json_group_array(${revisionTags.tag}) from ${revisionTags} where ${and(
    eq(revisionTags.revisionId, revision.id),
    eq(revisionTags.siteId, revision.siteId),
  )})`
}

type EntryRow = { [Field in keyof typeof entryFields]: (typeof entries.$inferSelect)[Field] }
type RevisionRow = {
  [Field in keyof typeof revisionFields]: (typeof revisions.$inferSelect)[Field]
}
type RevisionSummaryRow = {
  [Field in keyof typeof revisionSummaryFields]: (typeof revisions.$inferSelect)[Field]
}
type PublicationRow = {
  [Field in keyof typeof publicationFields]: (typeof publications.$inferSelect)[Field]
}

/** The value of `candidates` that `value` is, or a failure: the schema's `CHECK`s forbid the rest. */
function oneOf<const Candidates extends readonly string[]>(
  candidates: Candidates,
  value: string,
  what: string,
): Candidates[number] {
  for (const candidate of candidates) if (candidate === value) return candidate
  throw new Error(`A row has ${what} ${JSON.stringify(value)}, which the schema does not allow`)
}

/** The status of an entry, which the schema's `CHECK` limits to these three. */
export function entryStatus(value: string): StoredEntry['status'] {
  return oneOf(['draft', 'scheduled', 'published'], value, 'the status')
}

export function toEntry(row: EntryRow): StoredEntry {
  return {
    id: row.id,
    collection: row.collection,
    locale: row.locale,
    slug: row.slug,
    translationGroup: row.translationGroup,
    status: entryStatus(row.status),
    version: row.version,
    headRevision: row.headRev,
    publishedRevision: row.publishedRev,
    publishedAt: row.publishedAt,
    scheduledAt: row.scheduledAt,
    deletedAt: row.deletedAt,
    updatedAt: row.updatedAt,
  }
}

function toActor(row: {
  actorKind: string
  actorUserId: string
  actorTokenId: string | null
  actorMeta: string | null
}): Actor {
  const meta: Readonly<Record<string, unknown>> | null =
    row.actorMeta === null ? null : JSON.parse(row.actorMeta)
  return {
    kind: oneOf(['token', 'user', 'oauth_client'], row.actorKind, 'the actor kind'),
    userId: row.actorUserId,
    tokenId: row.actorTokenId,
    meta,
  }
}

/** The tags come back sorted, so that a revision reads the same however its tags were written. */
function parseTags(tagsJson: string): string[] {
  const tags: string[] = JSON.parse(tagsJson)
  return tags.toSorted()
}

export function toRevision(row: RevisionRow, tagsJson: string): StoredRevision {
  const frontmatter: Readonly<Record<string, unknown>> = JSON.parse(row.frontmatter)
  const document: EntryDocument = JSON.parse(row.document)
  const verdict: Verdict = JSON.parse(row.verdict)
  return {
    id: row.id,
    entryId: row.entryId,
    markdown: row.markdown,
    frontmatter,
    document,
    comarkVersion: row.comarkVersion,
    pipelineVersion: row.pipelineVersion,
    wordCount: row.wordCount,
    codeWords: row.codeWords,
    verdict,
    tags: parseTags(tagsJson),
    actor: toActor(row),
    createdAt: row.createdAt,
  }
}

export function toRevisionSummary(row: RevisionSummaryRow, tagsJson: string): RevisionSummary {
  const frontmatter: Readonly<Record<string, unknown>> = JSON.parse(row.frontmatter)
  return {
    id: row.id,
    frontmatter,
    tags: parseTags(tagsJson),
    wordCount: row.wordCount,
    codeWords: row.codeWords,
    createdAt: row.createdAt,
  }
}

export function toPublication(row: PublicationRow): StoredPublication {
  const verdict: Verdict | null = row.verdict === null ? null : JSON.parse(row.verdict)
  const acknowledged: AcknowledgedWarning[] = JSON.parse(row.acknowledged)
  return {
    id: row.id,
    entryId: row.entryId,
    action: oneOf(['publish', 'unpublish'], row.action, 'the action'),
    revisionId: row.revisionId,
    verdict,
    acknowledged,
    actor: toActor(row),
    createdAt: row.createdAt,
  }
}
