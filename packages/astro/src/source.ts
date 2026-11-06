import {
  createClient,
  HollwareClientError,
  type CollectionNavigation,
  type HollwareReader,
  type PageAncestor,
  type PageImage,
} from '@hollware/client'

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
  /**
   * Astro's id: the slug, or in a nested collection the slugs of its ancestors and its own joined
   * by `/`, for a `[...path]` route. Unique within the locale.
   */
  readonly id: string
  /** In a nested collection, the slug of its parent; `null` at the root and in a flat one. */
  readonly parent: string | null
  /** In a nested collection, its ancestors from the root down: only an entry read alone has them. */
  readonly ancestors?: readonly PageAncestor[]
  /** The frontmatter of the entry. */
  readonly data: Record<string, unknown>
  /** The HTML Hollware renders from the Markdown: only an entry read alone has it. */
  readonly html?: string
  /** The Comark document, for `HollwareContent.astro`: only an entry read alone has it. */
  readonly document?: unknown
  /** The images its frontmatter names, by URL, with their size, alt and `srcset`. */
  readonly images?: Readonly<Record<string, PageImage>>
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
   * The entry with this id (its slug, or the path of slugs of a nested entry: the last slug names
   * it) and its HTML, or `undefined` when it is not published. Its `id` is where it is now, so a
   * page asked for an older path redirects to it. With a
   * `preview` token (made in the admin) it is the latest revision of the entry the token names,
   * a draft included; a token that does not hold is an error, never the published version.
   */
  get(id: string, options?: { readonly preview?: string }): Promise<SourceEntry | undefined>
  translations(group: string): Promise<Translation[]>
  /** The published entries of the locale, grouped and ordered as the collection's navigation says. */
  navigation(): Promise<CollectionNavigation>
}

const PAGE = 100

function readerOf(options: ReaderOptions): HollwareReader {
  if ('reader' in options) {
    return typeof options.reader === 'function' ? options.reader() : options.reader
  }
  return createClient({ url: options.url, token: options.token, fetch: options.fetch })
}

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
          found.push({
            id: entry.slugPath,
            parent: entry.parent,
            data: entry.frontmatter,
            updatedAt: entry.updatedAt,
            ...(entry.images === undefined ? {} : { images: entry.images }),
          })
        }
        cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
      return found
    },
    async get(id, getOptions = {}) {
      const slug =
        id
          .split('/')
          .filter((segment) => segment !== '')
          .at(-1) ?? id
      const answer = await readerOf(options).getEntry(site, collection, slug, locale, {
        formats: ['html', 'document'],
        ...(getOptions.preview === undefined ? {} : { preview: getOptions.preview }),
      })
      if (answer.outcome === 'not_found' || answer.entry === undefined) return undefined
      return {
        id: answer.entry.slugPath,
        parent: answer.entry.parent,
        ...(answer.ancestors === undefined ? {} : { ancestors: answer.ancestors }),
        data: answer.entry.frontmatter,
        html: answer.entry.html ?? '',
        updatedAt: answer.entry.updatedAt,
        ...(answer.entry.document === undefined ? {} : { document: answer.entry.document }),
        ...(answer.entry.images === undefined ? {} : { images: answer.entry.images }),
      }
    },
    async translations(group) {
      const answer = await readerOf(options).getTranslations(site, collection, group)
      return (answer.entries ?? []).map((entry) => ({ locale: entry.locale, slug: entry.slug }))
    },
    async navigation() {
      const answer = await readerOf(options).getNavigation(site, collection, { locale })
      return { collection: answer.collection, locale: answer.locale, groups: answer.groups }
    },
  }
}

export function asError(error: unknown): Error {
  if (error instanceof HollwareClientError) {
    return new Error(`Hollware answered ${error.status} (${error.code}): ${error.message}`, {
      cause: error,
    })
  }
  return error instanceof Error ? error : new Error(String(error))
}
