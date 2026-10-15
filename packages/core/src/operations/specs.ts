import * as z from 'zod'
import {
  acknowledgedWarning,
  collectionName,
  conflict,
  entry,
  entryId,
  entryStatus,
  entrySummary,
  format,
  locale,
  markdown,
  review,
  reviewId,
  reviewStatus,
  searchMode,
  siteDescription,
  slug,
  verdict,
  version,
} from './schemas.ts'
import { defineOperation } from './types.ts'

/**
 * The operations of v0.1, specified once (ADR-017). The outcomes and the effect of each one are
 * the table of the v0.1 plan; `tests/operations.test.ts` holds it literally. Inputs are strict
 * objects, so a misspelled field is an error instead of being ignored.
 */

export const describeSite = defineOperation({
  name: 'describe_site',
  title: 'Describe the site',
  description:
    'Describes the site: its locales, and for each collection the JSON Schema of the frontmatter, the components the body may use, the contracts that writes and publishes are checked against, and the style guides. Read it before writing.',
  input: z.strictObject({}),
  output: z.object({ outcome: z.enum(['ok']), site: siteDescription }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false } },
})

export const listEntries = defineOperation({
  name: 'list_entries',
  title: 'List entries',
  description:
    'Lists the entries of a collection, newest first, filtered by locale, tag or status. Pass the nextCursor of an answer as cursor to get the next page.',
  input: z.strictObject({
    collection: collectionName,
    locale: locale.optional(),
    tag: z.string().min(1).optional(),
    status: entryStatus.optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).optional(),
  }),
  output: z.object({
    outcome: z.enum(['ok']),
    entries: z.array(entrySummary),
    nextCursor: z.string().nullable().describe('The cursor of the next page, or null.'),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false } },
})

export const search = defineOperation({
  name: 'search',
  title: 'Search entries',
  description:
    'Searches the published entries of the site, best match first. Full text finds the entries that hold every word of query, in their title, tags and text; semantic finds them by meaning, in any language; hybrid merges both. Narrow it to a collection or a locale. Drafts are not searched: read them with list_entries.',
  input: z.strictObject({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe('The words to find, or a question; punctuation is ignored by full text.'),
    collection: collectionName.optional(),
    locale: locale.optional(),
    limit: z.number().int().min(1).max(50).default(10),
    mode: searchMode
      .optional()
      .describe(
        'fulltext, semantic or hybrid; hybrid when not given. Semantic and hybrid need the semantic search of the deployment: without it the search is full text, and mode in the answer says so.',
      ),
  }),
  output: z.object({
    outcome: z.enum(['ok']),
    mode: searchMode.describe('How the search was made.'),
    results: z.array(
      z.object({
        entry: entrySummary,
        snippet: z
          .string()
          .describe(
            'The words around the match, the words found between [ and ]; for a match by meaning, the start of the closest part.',
          ),
        score: z.number().describe('How well it matches: higher is better.'),
      }),
    ),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false } },
})

export const getEntry = defineOperation({
  name: 'get_entry',
  title: 'Get an entry',
  description:
    'Gets an entry by collection, locale and slug, with its latest revision: the Markdown, the frontmatter, the verdict of its contracts and its last publication.',
  input: z.strictObject({
    collection: collectionName,
    locale,
    slug,
    formats: z
      .array(format)
      .min(1)
      .default(['markdown'])
      .describe('What to return of the revision: markdown, the Comark document, or html.'),
    published: z
      .boolean()
      .default(false)
      .describe(
        'Read the revision that is live instead of the latest one: not_found when the entry is not published.',
      ),
    related: z
      .boolean()
      .default(false)
      .describe(
        'Also return the published entries closest to this one by meaning, in its collection and locale, closest first. Needs the semantic search of the deployment; empty without it.',
      ),
  }),
  output: z.object({
    outcome: z.enum(['ok', 'not_found']),
    entry: entry.optional(),
    related: z.array(entrySummary).optional().describe('When related was asked for.'),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false }, not_found: { isError: true } },
})

export const getTranslations = defineOperation({
  name: 'get_translations',
  title: 'Get the translations of an entry',
  description:
    'Gets the entries of a translation group of a collection, one per locale. The group is the value of the field that describe_site names as translationGroupField.',
  input: z.strictObject({
    collection: collectionName,
    translationGroup: z.string().min(1),
  }),
  output: z.object({
    outcome: z.enum(['ok', 'not_found']),
    entries: z.array(entrySummary).optional(),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false }, not_found: { isError: true } },
})

export const createDraft = defineOperation({
  name: 'create_draft',
  title: 'Create a draft',
  description:
    'Creates an entry from a Markdown file and saves it as a draft at version 1. Contract errors do not stop the draft: it is saved, and the verdict says what to fix before publishing. It is refused only when it cannot be stored: the file is too large, its frontmatter or syntax does not parse, or the slug or translation is taken.',
  input: z.strictObject({ collection: collectionName, locale, slug, markdown }),
  output: z.object({
    outcome: z.enum(['saved', 'refused']),
    entry: entrySummary.optional(),
    verdict: verdict.optional(),
  }),
  scopes: ['content:write'],
  effect: 'write',
  outcomes: { saved: { isError: false }, refused: { isError: true } },
})

export const updateDraft = defineOperation({
  name: 'update_draft',
  title: 'Update a draft',
  description:
    'Saves a new revision of an entry from the whole Markdown file, if the entry is still at the version you read; otherwise it answers conflict with the current version, and nothing is saved. A file identical to the latest revision answers unchanged. Contract errors do not stop the save; the verdict says what to fix.',
  input: z.strictObject({ id: entryId, version, markdown }),
  output: z.object({
    outcome: z.enum(['saved', 'unchanged', 'conflict', 'not_found', 'refused']),
    entry: entrySummary.optional(),
    verdict: verdict.optional(),
    conflict: conflict.optional(),
  }),
  scopes: ['content:write'],
  effect: 'edit',
  outcomes: {
    saved: { isError: false },
    unchanged: { isError: false },
    conflict: { isError: true },
    not_found: { isError: true },
    refused: { isError: true },
  },
})

export const validate = defineOperation({
  name: 'validate',
  title: 'Validate a Markdown file',
  description:
    'Checks a Markdown file against every contract of the collection, as publish would, without saving anything: the verdict lists each problem with its fix.',
  input: z.strictObject({ collection: collectionName, locale, slug, markdown }),
  output: z.object({ outcome: z.enum(['ok']), verdict }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false } },
})

export const publish = defineOperation({
  name: 'publish',
  title: 'Publish an entry',
  description:
    'Publishes the latest revision of an entry, if the entry is still at the version you read, and with group, other entries in the same step. It is blocked while the contracts report errors. Warnings have to be acknowledged: an answer of needs_acknowledgement lists them, and publish again with them in acknowledgeWarnings. Publish entries that link to each other as one group. Without content:publish, the same checks run and the answer is pending_review: a person who may publish approves the revision or asks for changes, and a new revision of the entry cancels the request. A review is for one entry, now: never with group or publishAt.',
  input: z.strictObject({
    id: entryId,
    version,
    acknowledgeWarnings: z
      .array(acknowledgedWarning)
      .default([])
      .describe('The warnings you accept, as needs_acknowledgement listed them.'),
    group: z
      .array(z.strictObject({ id: entryId, version }))
      .max(99)
      .default([])
      .describe(
        'Other entries to publish in the same step, each with the version you read: all of them are published, or none. A link between two of them counts as published, and an acknowledged warning holds for every entry that reports it.',
      ),
    publishAt: z.iso
      .datetime({ offset: true })
      .optional()
      .describe(
        'Publish at this time instead of now, as an ISO 8601 date and time: the entry is checked now and waits as scheduled, and it is published within a minute of the time, if nobody changes it before. One entry at a time, never with group.',
      ),
  }),
  output: z.object({
    outcome: z.enum([
      'published',
      'scheduled',
      'blocked',
      'needs_acknowledgement',
      'pending_review',
      'conflict',
      'not_found',
    ]),
    entry: entrySummary.optional(),
    verdict: verdict.optional(),
    conflict: conflict.optional(),
    review: review
      .optional()
      .describe('With pending_review: the request, as list_reviews shows it.'),
    failedEntry: entryId
      .optional()
      .describe(
        'In a group, the entry that kept the group from being published: blocked, stale, missing, or with a warning to acknowledge.',
      ),
  }),
  scopes: ['content:write'],
  effect: 'write',
  outcomes: {
    published: { isError: false },
    scheduled: { isError: false },
    blocked: { isError: true },
    needs_acknowledgement: { isError: false },
    pending_review: { isError: false },
    conflict: { isError: true },
    not_found: { isError: true },
  },
})

export const unpublish = defineOperation({
  name: 'unpublish',
  title: 'Unpublish an entry',
  description:
    'Takes an entry off the public site and keeps it, with its revisions, as a draft. An entry that is not published stays as it is.',
  input: z.strictObject({ id: entryId }),
  output: z.object({
    outcome: z.enum(['unpublished', 'not_found']),
    entry: entrySummary.optional(),
  }),
  scopes: ['content:publish'],
  effect: 'destructive',
  outcomes: { unpublished: { isError: false }, not_found: { isError: true } },
})

export const listReviews = defineOperation({
  name: 'list_reviews',
  title: 'List the reviews',
  description:
    'Lists the requests to publish, newest first, with the entry each one is for: the pending ones unless you name another status.',
  input: z.strictObject({
    status: reviewStatus.default('pending'),
    limit: z.number().int().min(1).max(100).default(50),
  }),
  output: z.object({
    outcome: z.enum(['ok']),
    reviews: z.array(review.extend({ entry: entrySummary })),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false } },
})

export const approveReview = defineOperation({
  name: 'approve_review',
  title: 'Approve a review',
  description:
    'Publishes the revision a review asked for, in your name, after the contracts run again as publish runs them. The warnings the request acknowledged count as acknowledged; a new one answers needs_acknowledgement, and you approve again with it in acknowledgeWarnings.',
  input: z.strictObject({
    id: reviewId,
    acknowledgeWarnings: z
      .array(acknowledgedWarning)
      .default([])
      .describe('Warnings you accept besides those the request acknowledged.'),
  }),
  output: z.object({
    outcome: z.enum(['published', 'blocked', 'needs_acknowledgement', 'not_pending', 'not_found']),
    review: review.optional(),
    entry: entrySummary.optional(),
    verdict: verdict.optional(),
  }),
  scopes: ['content:publish'],
  effect: 'write',
  outcomes: {
    published: { isError: false },
    blocked: { isError: true },
    needs_acknowledgement: { isError: false },
    not_pending: { isError: true },
    not_found: { isError: true },
  },
})

export const requestChanges = defineOperation({
  name: 'request_changes',
  title: 'Ask for changes',
  description:
    'Closes a pending review without publishing, with a note that says what to change. The author saves a new revision and asks again.',
  input: z.strictObject({
    id: reviewId,
    note: z.string().trim().min(1).max(4000).describe('What to change, for the author.'),
  }),
  output: z.object({
    outcome: z.enum(['changes_requested', 'not_pending', 'not_found']),
    review: review.optional(),
  }),
  scopes: ['content:publish'],
  effect: 'edit',
  outcomes: {
    changes_requested: { isError: false },
    not_pending: { isError: true },
    not_found: { isError: true },
  },
})

export const contentStats = defineOperation({
  name: 'content_stats',
  title: 'Read what readers read',
  description:
    'The most read pages of the sites that read this one, over the last days, most read first, each with the published entry it shows when it shows one. Use it to pick what to update. unavailable when the deployment has no analytics.',
  input: z.strictObject({
    days: z.number().int().min(1).max(90).default(30).describe('How many days back to count.'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  output: z.object({
    outcome: z.enum(['ok', 'unavailable']),
    since: z.string().optional().describe('The start of the count, in ISO 8601.'),
    pages: z
      .array(
        z.object({
          path: z.string(),
          views: z.number().describe('Page views, sampling accounted for.'),
          entry: entrySummary.nullable().describe('The published entry at that path, or null.'),
        }),
      )
      .optional(),
  }),
  scopes: ['content:read'],
  effect: 'read',
  outcomes: { ok: { isError: false }, unavailable: { isError: true } },
})

/** Every operation, sorted by name: the order of `tools/list`. */
export const OPERATIONS = [
  approveReview,
  contentStats,
  createDraft,
  describeSite,
  getEntry,
  getTranslations,
  listEntries,
  listReviews,
  publish,
  requestChanges,
  search,
  unpublish,
  updateDraft,
  validate,
] as const

export type Operation = (typeof OPERATIONS)[number]

export type OperationName = Operation['name']

/** The spec of an operation, by its name. */
export type OperationByName<Name extends OperationName> = Extract<Operation, { name: Name }>
