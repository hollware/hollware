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

/**
 * What the operations answer with, made from what the store returns. The shapes are the ones of
 * the output schemas of `@hollware/core`: plain objects with mutable arrays, which is what an
 * adapter serializes and checks.
 */

export type EntrySummary = z.output<typeof schemas.entrySummary>
export type VerdictOutput = z.output<typeof schemas.verdict>
export type PublicationOutput = z.output<typeof schemas.publication>
export type ConflictOutput = z.output<typeof schemas.conflict>
export type ReviewOutput = z.output<typeof schemas.review>

/** A review as an output. */
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

/**
 * The summary of an entry, from a listing (`EntrySummaryView`) or from a read of one entry
 * (`EntryView`, which has all of the summary's fields and more). `hasUnpublishedChanges` says
 * whether the latest revision differs from the one that is live, so an entry that was never
 * published always has them.
 */
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
    updatedAt: entry.updatedAt,
  }
}

/** A verdict as an output: the same facts, in arrays that the caller may own. */
export function verdictView(verdict: Verdict): VerdictOutput {
  return {
    ok: verdict.ok,
    phase: verdict.phase,
    errors: [...verdict.errors],
    warnings: [...verdict.warnings],
    contractsHash: verdict.contractsHash,
  }
}

/**
 * The verdict of a refusal: the violations of the pipeline, or of a write that the store turned
 * down, in the phase of the operation. No contract ran, and the empty hash says so: a hash names
 * the rules a verdict answers to, and this one answers to none.
 */
export function refusalVerdict(phase: Phase, violations: readonly Violation[]): VerdictOutput {
  return { ok: false, phase, errors: [...violations], warnings: [], contractsHash: '' }
}

/** What `conflict` carries: the version the entry is at now, and its latest revision. */
export function conflictAt(currentVersion: number, headRevision: string): ConflictOutput {
  return { currentVersion, headRevision }
}

/**
 * The violation of a write that the store turned down because of what is stored: another entry
 * holds its slug or its translation, or its row would be over the limit of D1. These are the
 * refusals that make a write `refused`; the store never answers `taken` to a collection that has
 * no translations, since its entries have no group.
 */
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

/**
 * The last publication of an entry as `get_entry` shows it: the latest one when it is a publish,
 * and nothing when the entry was unpublished since, or never published.
 */
export function publicationView(publication: StoredPublication | null): PublicationOutput | null {
  if (publication === null || publication.action !== 'publish') return null
  if (publication.revisionId === null || publication.verdict === null) {
    // The `publications_shape` check of the schema forbids it: a publish names a revision and a verdict.
    throw new Error(`The publication ${publication.id} is a publish with no revision or verdict`)
  }
  return {
    revision: publication.revisionId,
    verdict: verdictView(publication.verdict),
    acknowledged: publication.acknowledged.map(({ contract, path }) => ({ contract, path })),
    at: publication.createdAt,
  }
}

/** A comment on a review as the operations answer it; `client` is the name its client gave. */
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
