import { pointer, quote } from './text.ts'
import type { Violation } from './types.ts'

/** Another entry of the collection and locale has the slug. The slug is no field of the file. */
export function uniqueSlugViolation(holder: string): Violation {
  return {
    contract: 'unique-slug',
    severity: 'error',
    path: '',
    message: `Another entry of this collection and locale, ${holder}, already has this slug.`,
    fix: `Choose another slug, or change the entry ${holder} with update_draft.`,
    params: { holder },
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
    params: { holder, field },
  }
}

/** A nested entry that cannot go under the parent it names. */
export function parentViolation(
  reason: 'not_nested' | 'missing' | 'too_deep' | 'unpublished' | 'changed',
  params: { readonly parent: string; readonly maxDepth: number | null },
): Violation {
  const messages = {
    not_nested: {
      message: `The collection is flat, so the entry cannot go under ${quote(params.parent)}.`,
      fix: 'Leave parent out, or give the collection nesting with set_collection.',
    },
    missing: {
      message: `The collection and locale have no entry ${quote(params.parent)} to put it under.`,
      fix: `Use the slug of an entry of the collection and locale (list_entries lists them), or create ${quote(params.parent)} first.`,
    },
    changed: {
      message: `The entries around ${quote(params.parent)} kept changing while this one was written.`,
      fix: 'Write it again: nothing was saved.',
    },
    unpublished: {
      message: `Its parent ${quote(params.parent)} is not published, so the entry would have no page above it.`,
      fix: `Publish ${quote(params.parent)} first, or publish both in one group.`,
    },
    too_deep: {
      message: `Under ${quote(params.parent)}, the entry would be deeper than the ${params.maxDepth ?? 0} levels the collection allows.`,
      fix: 'Put it under an entry nearer the root, or raise nesting.maxDepth with set_collection.',
    },
  }
  return {
    contract: 'entry-parent',
    severity: 'error',
    path: '',
    ...messages[reason],
    params: { reason, parent: params.parent },
  }
}

/** An entry to unpublish whose published children would be left with no page above them. */
export function childrenViolation(children: readonly string[]): Violation {
  const names = children.map(quote).join(', ')
  return {
    contract: 'entry-parent',
    severity: 'error',
    path: '',
    message: `Its published children ${names} would be left with no page above them.`,
    fix: 'Unpublish its children in the same review, or before it.',
    params: { reason: 'has_children', children: children.join(',') },
  }
}
