import * as z from 'zod'

/** The arguments of `resolvePath`: a path of the site, such as `/help/billing/refunds/`. */
export const resolvePathInput = z.strictObject({
  path: z.string().min(1).max(2048).startsWith('/'),
})

/**
 * What `resolvePath` answers for a path of the site: the entry it names, by the routes of the
 * collections; where the entry is now, for a path it had (an old slug, or the old place of it or
 * of an ancestor), to answer with a 301; or `not_found`.
 */
export type ResolvedPath =
  | {
      readonly outcome: 'ok'
      readonly collection: string
      readonly locale: string
      readonly slug: string
      readonly path: string
    }
  | {
      readonly outcome: 'redirect'
      readonly collection: string
      readonly locale: string
      readonly slug: string
      /** The path it has now, to answer the one asked for with a 301. */
      readonly path: string
    }
  | { readonly outcome: 'not_found' }
