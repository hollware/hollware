import {
  sizeLimitViolation,
  uniqueSlugViolation,
  uniqueTranslationViolation,
  type Phase,
  type ResolvedCollection,
  type schemas,
  type Verdict,
  type Violation,
} from '@hollware/core'
import type * as z from 'zod'
import type {
  EntrySummaryView,
  StoredPublication,
  StoredReview,
  WriteRefusal,
  StoredReviewComment,
} from '../ports.ts'

export type EntrySummary = z.output<typeof schemas.entrySummary>
export type VerdictOutput = z.output<typeof schemas.verdict>
export type PublicationOutput = z.output<typeof schemas.publication>
export type ConflictOutput = z.output<typeof schemas.conflict>
export type ReviewOutput = z.output<typeof schemas.review>

export function reviewView(review: StoredReview): ReviewOutput {
  return {
    id: review.id,
    entryId: review.entryId,
    revision: review.revisionId,
    status: review.status,
    requestedBy: review.requestedBy,
    requestedByName: review.requestedByName,
    requestedAt: review.requestedAt,
    decidedBy: review.decidedBy,
    decidedAt: review.decidedAt,
    note: review.note,
  }
}

export function entrySummary(view: EntrySummaryView): EntrySummary {
  const { entry, revision } = view
  return {
    id: entry.id,
    collection: entry.collection,
    locale: entry.locale,
    slug: entry.slug,
    translationGroup: entry.translationGroup,
    status: entry.status,
    version: entry.version,
    frontmatter: revision.frontmatter,
    tags: [...revision.tags],
    hasUnpublishedChanges: entry.publishedRevision !== entry.headRevision,
    publishedAt: entry.publishedAt,
    scheduledAt: entry.scheduledAt,
    deletedAt: entry.deletedAt,
    updatedAt: entry.updatedAt,
  }
}

export function verdictView(verdict: Verdict): VerdictOutput {
  return {
    ok: verdict.ok,
    phase: verdict.phase,
    errors: [...verdict.errors],
    warnings: [...verdict.warnings],
    contractsHash: verdict.contractsHash,
  }
}

export function refusalVerdict(phase: Phase, violations: readonly Violation[]): VerdictOutput {
  return { ok: false, phase, errors: [...violations], warnings: [], contractsHash: '' }
}

export function conflictAt(currentVersion: number, headRevision: string): ConflictOutput {
  return { currentVersion, headRevision }
}

export function violationOf(
  refusal: Extract<WriteRefusal, { readonly outcome: 'taken' | 'too_large' }>,
  collection: ResolvedCollection,
): Violation {
  if (refusal.outcome === 'too_large') return sizeLimitViolation(refusal.bytes, refusal.limit)
  if (refusal.field === 'slug') return uniqueSlugViolation(refusal.by)
  const field = collection.translationGroupField
  if (field === null) {
    throw new Error(
      `The store said that a translation group is taken in the collection ${collection.name}, which has no translations`,
    )
  }
  return uniqueTranslationViolation(refusal.by, field)
}

export function publicationView(publication: StoredPublication | null): PublicationOutput | null {
  if (publication === null || publication.action !== 'publish') return null
  if (publication.revisionId === null || publication.verdict === null) {
    throw new Error(`The publication ${publication.id} is a publish with no revision or verdict`)
  }
  return {
    revision: publication.revisionId,
    verdict: verdictView(publication.verdict),
    acknowledged: publication.acknowledged.map(({ contract, path }) => ({ contract, path })),
    at: publication.createdAt,
  }
}

export function reviewCommentView(comment: StoredReviewComment) {
  const name = comment.authorMeta?.['name']
  return {
    id: comment.id,
    author: comment.authorId,
    authorName: comment.authorName,
    client: typeof name === 'string' ? name : null,
    body: comment.body,
    at: comment.createdAt,
  }
}
