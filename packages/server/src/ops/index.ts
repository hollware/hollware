import { createDraft } from './create-draft.ts'
import { describeSite } from './describe-site.ts'
import { getEntry } from './get-entry.ts'
import { getTranslations } from './get-translations.ts'
import { listEntries } from './list-entries.ts'
import { publish } from './publish.ts'
import { unpublish } from './unpublish.ts'
import { updateDraft } from './update-draft.ts'
import { validate } from './validate.ts'
import { defineHandlers } from './types.ts'

/**
 * The handler of every operation of v0.1, paired with its spec of `@hollware/core` by type
 * (ADR-017). Adapters check the scopes and build the `OperationContext`; a handler never sees a
 * request, and reads and writes only the site of its context.
 */
export const handlers = defineHandlers({
  create_draft: createDraft,
  describe_site: describeSite,
  get_entry: getEntry,
  get_translations: getTranslations,
  list_entries: listEntries,
  publish,
  unpublish,
  update_draft: updateDraft,
  validate,
})
