import * as z from 'zod'

const base = {
  id: z.string(),
  site: z.string(),
  at: z.string(),
  cacheTags: z.array(z.string()),
}

/** A publish or an unpublish: the entry, and where it lives on the site. */
export const entryEvent = z.object({
  ...base,
  kind: z.enum(['entry.published', 'entry.unpublished']),
  entry: z.object({
    id: z.string(),
    collection: z.string(),
    locale: z.string(),
    slug: z.string(),
    translationGroup: z.string().nullable(),
  }),
  /** The path of the entry on the site, from the route of its collection and locale. */
  path: z.string().nullable(),
  /** The URL of the entry, when the site has a `url`. */
  url: z.string().nullable(),
})

/** A change of the site's structure: no entry, the tags to purge. */
export const siteEvent = z.object({
  ...base,
  kind: z.literal('site.changed'),
})

/** Every event a webhook gets. */
export const hollwareEvent = z.discriminatedUnion('kind', [entryEvent, siteEvent])

export type EntryEvent = z.infer<typeof entryEvent>
export type SiteEvent = z.infer<typeof siteEvent>
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
