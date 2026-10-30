import * as z from 'zod'

const base = {
  id: z
    .string()
    .describe('The id of the event, the same on every retry: ignore one you already have.'),
  site: z.string().describe('The key of the site it happened in.'),
  at: z.string().describe('When it happened, as an ISO 8601 timestamp.'),
  cacheTags: z
    .array(z.string())
    .describe('The cache tags of the pages it changed, to purge; none when no page changed.'),
}

/** A publish or an unpublish: the entry, and where it lives on the site. */
export const entryEvent = z.object({
  ...base,
  kind: z.enum(['entry.published', 'entry.unpublished']),
  entry: z
    .object({
      id: z.string(),
      collection: z.string(),
      locale: z.string(),
      slug: z.string(),
      translationGroup: z.string().nullable(),
    })
    .describe('The entry: its id, collection, locale, slug and translation group.'),
  path: z
    .string()
    .nullable()
    .describe('The path of the entry on the site, from the route of its collection and locale.'),
  url: z.string().nullable().describe('The URL of the entry, when the site has a url.'),
})

/** A change of the site's structure: no entry, the tags to purge. */
export const siteEvent = z.object({
  ...base,
  kind: z.literal('site.changed'),
})

export const reviewEvent = z.object({
  ...base,
  kind: z.enum(['review.requested', 'review.decided']),
  review: z
    .object({
      id: z.string(),
      status: z.enum(['pending', 'approved', 'changes_requested', 'rejected', 'cancelled']),
      requestedBy: z.string().nullable(),
      note: z.string().nullable(),
    })
    .describe(
      'The review: its id, its status (pending when asked, what became of it when decided), the name of who asked, and the note of a reviewer who asked for changes or rejected it.',
    ),
  entry: z
    .object({
      id: z.string(),
      collection: z.string(),
      locale: z.string(),
      slug: z.string(),
      translationGroup: z.string().nullable(),
    })
    .describe('The entry the review asks to publish.'),
  items: z
    .array(z.object({ entryId: z.string(), action: z.enum(['publish', 'unpublish']) }))
    .optional()
    .describe('Every entry the review changes, the entry above first, and what it does to each.'),
  adminPath: z
    .string()
    .describe('Where a person reads the review in the admin, under the URL of this Hollware.'),
})

/** Every event a webhook gets. */
export const hollwareEvent = z.discriminatedUnion('kind', [entryEvent, siteEvent, reviewEvent])

export type EntryEvent = z.infer<typeof entryEvent>
export type SiteEvent = z.infer<typeof siteEvent>
export type ReviewEvent = z.infer<typeof reviewEvent>
export type HollwareEvent = z.infer<typeof hollwareEvent>

/**
 * The event of a webhook's body, once its signature holds, or `null` for a body that is not one
 * of the events this version knows (a newer kind, say): a receiver skips it.
 */
export function parseHollwareEvent(body: string): HollwareEvent | null {
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = hollwareEvent.safeParse(json)
  return parsed.success ? parsed.data : null
}
