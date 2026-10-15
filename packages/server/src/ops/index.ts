import { contentStats } from './content-stats.ts'
import { createDraft } from './create-draft.ts'
import { describeSite } from './describe-site.ts'
import { getEntry } from './get-entry.ts'
import { getTranslations } from './get-translations.ts'
import { listEntries } from './list-entries.ts'
import { search } from './search.ts'
import { publish } from './publish.ts'
import {
  approveReview,
  commentReview,
  listReviews,
  requestChanges,
  requestReview,
} from './reviews.ts'
import { unpublish } from './unpublish.ts'
import { updateDraft } from './update-draft.ts'
import { validate } from './validate.ts'
import { defineHandlers } from './types.ts'

/**
 * The handler of every operation, paired with its spec of `@hollware/core` by type
 * (ADR-017). Adapters check the scopes and build the `OperationContext`; a handler never sees a
 * request, and reads and writes only the site of its context.
 */
export const handlers = defineHandlers({
  approve_review: approveReview,
  comment_review: commentReview,
  content_stats: contentStats,
  create_draft: createDraft,
  describe_site: describeSite,
  get_entry: getEntry,
  get_translations: getTranslations,
  list_entries: listEntries,
  search,
  list_reviews: listReviews,
  publish,
  request_changes: requestChanges,
  request_review: requestReview,
  unpublish,
  update_draft: updateDraft,
  validate,
})
