import { pointer, quote } from './text.ts'
import type { Violation } from './types.ts'

/**
 * The violations of a write that the store refuses because another entry of the same collection
 * and locale holds what has to be unique there: the slug, or the translation group. `holder` is
 * the id of that entry. Like `sizeLimitViolation`, they make the write `refused`, and every such
 * refusal reads the same.
 */

/** Another entry of the collection and locale has the slug. The slug is no field of the file. */
export function uniqueSlugViolation(holder: string): Violation {
  return {
    contract: 'unique-slug',
    severity: 'error',
    path: '',
    message: `Another entry of this collection and locale, ${holder}, already has this slug.`,
    fix: `Choose another slug, or change the entry ${holder} with update_draft.`,
  }
}

/** Another entry of the collection and locale belongs to the translation group in `field`. */
export function uniqueTranslationViolation(holder: string, field: string): Violation {
  return {
    contract: 'unique-translation',
    severity: 'error',
    path: `/frontmatter${pointer([field])}`,
    message: `Another entry of this collection and locale, ${holder}, already belongs to this translation group.`,
    fix: `Give ${quote(field)} another value, or change the entry ${holder} with update_draft: a translation group holds one entry per locale.`,
  }
}
