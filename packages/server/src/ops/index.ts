import { contentStats } from './content-stats.ts'
import { createDraft } from './create-draft.ts'
import { describeSite } from './describe-site.ts'
import { getEntry } from './get-entry.ts'
import { getTranslations } from './get-translations.ts'
import { listEntries } from './list-entries.ts'
import { search } from './search.ts'
import {
  createSite,
  deleteSite,
  getStructure,
  makeWebhookSecret,
  restoreSite,
  setCollection,
  updateSite,
} from './structure.ts'
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
  create_site: createSite,
  delete_site: deleteSite,
  describe_site: describeSite,
  get_entry: getEntry,
  get_structure: getStructure,
  get_translations: getTranslations,
  list_entries: listEntries,
  search,
  list_reviews: listReviews,
  make_webhook_secret: makeWebhookSecret,
  publish,
  request_changes: requestChanges,
  request_review: requestReview,
  restore_site: restoreSite,
  set_collection: setCollection,
  unpublish,
  update_site: updateSite,
  update_draft: updateDraft,
  validate,
})
