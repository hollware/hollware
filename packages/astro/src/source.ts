import { createClient, HollwareClientError, type HollwareReader } from '@hollware/client'

/** What names the collection to read: one collection of a site, in one locale. */
export interface SourceOptions {
  /** The key of the site in the Hollware config. */
  readonly site: string
  /** The collection to read, such as `blog`. */
  readonly collection: string
  /** The locale to read: an entry's id is its slug in this locale. */
  readonly locale: string
}

/** Where to read from: a reader (a service binding is one), or a Hollware URL and a read token. */
export type ReaderOptions =
  | {
      /**
       * A service binding to the `Hollware` entrypoint, or a function that gives it: a live
       * collection reads at request time, when the binding exists, so it passes
       * `() => env.HOLLWARE`.
       */
      readonly reader: HollwareReader | (() => HollwareReader)
    }
  | {
      /** The public URL of the Hollware. */
      readonly url: string
      /** A read token (`hw_read_`, from `hollware token create --read`). */
      readonly token: string
      /** `fetch`, when not the global one. */
      readonly fetch?: (request: Request) => Promise<Response>
    }

/** A published entry as the content layer takes it. */
export interface SourceEntry {
  /** The slug: Astro's id, unique within the locale. */
  readonly id: string
  /** The frontmatter of the entry. */
  readonly data: Record<string, unknown>
  /** The HTML Hollware renders from the Markdown: only an entry read alone has it. */
  readonly html?: string
  /** When the entry last changed, as an ISO date. */
  readonly updatedAt: string
}

/** The same entry in another locale. */
export interface Translation {
  readonly locale: string
  readonly slug: string
}

/** What a listing narrows to. */
export interface ListOptions {
  readonly tag?: string
  /** The most entries to return; all of them when not set. */
  readonly limit?: number
}

export interface Source {
  list(options?: ListOptions): Promise<SourceEntry[]>
  /**
   * The entry with this slug and its HTML, or `undefined` when it is not published. With a
   * `preview` token (made in the admin) it is the latest revision of the entry the token names,
   * a draft included; a token that does not hold is an error, never the published version.
   */
  get(slug: string, options?: { readonly preview?: string }): Promise<SourceEntry | undefined>
  translations(group: string): Promise<Translation[]>
}

/** The largest page the read API gives. */
const PAGE = 100

function readerOf(options: ReaderOptions): HollwareReader {
  if ('reader' in options) {
    return typeof options.reader === 'function' ? options.reader() : options.reader
  }
  return createClient({ url: options.url, token: options.token, fetch: options.fetch })
}

/**
 * Reads one collection of a site in one locale, published content only (but for `get` with a
 * preview token). The reader is resolved on
 * each call, so a live loader gets its service binding from the request that makes it.
 */
export function createSource(options: SourceOptions & ReaderOptions): Source {
  const { site, collection, locale } = options
  return {
    async list(listOptions = {}) {
      const reader = readerOf(options)
      const found: SourceEntry[] = []
      let cursor: string | undefined
      do {
        const remaining = listOptions.limit === undefined ? PAGE : listOptions.limit - found.length
        if (remaining <= 0) break
        const page = await reader.listEntries(site, collection, {
          locale,
          tag: listOptions.tag,
          limit: Math.min(PAGE, remaining),
          cursor,
        })
        for (const entry of page.entries) {
          found.push({ id: entry.slug, data: entry.frontmatter, updatedAt: entry.updatedAt })
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
      return found
    },
    async get(slug, getOptions = {}) {
      const answer = await readerOf(options).getEntry(site, collection, slug, locale, {
        formats: ['html'],
        ...(getOptions.preview === undefined ? {} : { preview: getOptions.preview }),
      })
      if (answer.outcome === 'not_found' || answer.entry === undefined) return undefined
      return {
        id: answer.entry.slug,
        data: answer.entry.frontmatter,
        html: answer.entry.html ?? '',
        updatedAt: answer.entry.updatedAt,
      }
    },
    async translations(group) {
      const answer = await readerOf(options).getTranslations(site, collection, group)
      return (answer.entries ?? []).map((entry) => ({ locale: entry.locale, slug: entry.slug }))
    },
  }
}

/** The error to hand Astro: a refusal of the read API keeps its status in the message. */
export function asError(error: unknown): Error {
  if (error instanceof HollwareClientError) {
    return new Error(`Hollware answered ${error.status} (${error.code}): ${error.message}`, {
      cause: error,
    })
  }
  return error instanceof Error ? error : new Error(String(error))
}
