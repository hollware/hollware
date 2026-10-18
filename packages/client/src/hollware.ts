import { createClient, type HollwareReader } from './index.ts'
import { isPreviewToken, previewTokenFromCookie } from './preview.ts'

/** Where to read from: a reader (a service binding is one), or a Hollware URL and a read token. */
export type ReaderOptions =
  | {
      /**
       * A service binding to the `Hollware` entrypoint, or a function that gives it: on Workers a
       * binding exists only while a request runs, so a module-level `createHollware` passes
       * `() => hollwareBinding(env.HOLLWARE)`.
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

/** The options of `createHollware`: the key of the site, and where to read it from. */
export type HollwareOptions = ReaderOptions & {
  /** The key of the site in the Hollware config. */
  readonly site: string
}

/** What a page shows of an entry in a listing: no verdict, no revision, no state of review. */
export interface PageSummary {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
  readonly frontmatter: Record<string, unknown>
  readonly tags: readonly string[]
  readonly publishedAt: string | null
  readonly updatedAt: string
}

/** The document of an entry: what `<HollwareContent>` of `@hollware/react` and `@hollware/vue` renders. */
export interface PageDocument {
  readonly nodes: readonly unknown[]
  readonly frontmatter: Record<string, unknown>
  readonly meta: Record<string, unknown>
}

/**
 * An entry for a page. A framework that renders on the server and hydrates in the browser sends
 * what a loader returns to the browser, so the entry holds only what a reader sees: its verdict,
 * its revision and its last publication stay on the server.
 */
export interface PageEntry extends PageSummary {
  readonly document?: PageDocument
}

/** What `getEntry` answers: the entry, and whether it is a preview. */
export interface EntryAnswer {
  readonly entry: PageEntry
  /**
   * `true` when the entry was read with a preview token, so it may be a draft and nothing may keep
   * the page: answer it `Cache-Control: no-store` (`previewHeaders` does).
   */
  readonly preview: boolean
}

/** The options of `getEntry`. */
export interface GetEntryOptions {
  /**
   * The incoming request: its `hollware_preview` cookie, when it has one, is the preview token
   * (`src/preview.ts`).
   */
  readonly request?: Request
  /**
   * The value of the `hollware_preview` cookie, when the framework gives cookies on their own
   * (`cookies()` of Next.js): it wins over `request`, and a value that is no token is ignored.
   */
  readonly preview?: string
}

/** What a listing narrows to. */
export interface ListEntriesOptions {
  readonly locale?: string
  readonly tag?: string
  /** The most entries to return, 100 at the most; Hollware's default when not set. */
  readonly limit?: number
  /** The `nextCursor` of the previous page. */
  readonly cursor?: string
}

/** A page of a listing: published entries, newest first. */
export interface EntryPage {
  readonly entries: PageSummary[]
  readonly nextCursor: string | null
}

/** The same entry in another locale. */
export interface Translation {
  readonly locale: string
  readonly slug: string
}

/** What a search narrows to. */
export interface SearchOptions {
  readonly collection?: string
  readonly locale?: string
  /** The most results, 50 at the most; Hollware's default when not set. */
  readonly limit?: number
  /** `hybrid` when not set; without semantic search in the deployment, the search is full text. */
  readonly mode?: 'fulltext' | 'semantic' | 'hybrid'
  /** Also the section each result matched: what a model reads to answer and cite (RAG). */
  readonly passages?: boolean
  /** The least score a match by meaning must reach, 0 to 1: a question nothing answers finds nothing. */
  readonly minScore?: number
}

/** What a search finds, best first, and how it searched. */
export interface SearchPage {
  readonly mode: 'fulltext' | 'semantic' | 'hybrid'
  readonly results: {
    readonly entry: PageSummary
    /** The words around the match, the words found between [ and ]. */
    readonly snippet: string
    readonly score: number
    /** With `passages`: the section that matched, its heading, and the URL of the entry. */
    readonly passage?: {
      readonly heading: string | null
      readonly text: string
      readonly url: string | null
    }
  }[]
}

/** What `describeSite` answers: the site's locales, collections and their rules. */
export type SiteDescription = Awaited<ReturnType<HollwareReader['describeSite']>>['site']

/** The read side of one Hollware site, for any code that turns a `Request` into data. */
export interface Hollware {
  /**
   * The entry in its locale, with its Comark document, or `undefined` when it is not published
   * (or, with a preview token, does not exist). With `request`, a preview token in its cookie
   * reads the latest revision of the entry the token names, a draft included. A token that is
   * expired or not valid is an error, never the published version: send it to
   * `previewHeaders(request, error)` to clear the cookie.
   */
  getEntry(
    collection: string,
    locale: string,
    slug: string,
    options?: GetEntryOptions,
  ): Promise<EntryAnswer | undefined>
  /** The published entries of a collection, newest first. */
  listEntries(collection: string, options?: ListEntriesOptions): Promise<EntryPage>
  /** The published entries of a translation group of a collection, one per locale. */
  getTranslations(collection: string, group: string): Promise<Translation[]>
  /** The published entries that match a query, best first: full text, by meaning, or both. */
  search(query: string, options?: SearchOptions): Promise<SearchPage>
  /** The site: its locales, its collections, their routes and their schemas. */
  describeSite(): Promise<SiteDescription>
}

function readerOf(options: ReaderOptions): HollwareReader {
  if ('reader' in options) {
    return typeof options.reader === 'function' ? options.reader() : options.reader
  }
  return createClient({ url: options.url, token: options.token, fetch: options.fetch })
}

interface SummaryFields {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly slug: string
  readonly translationGroup: string | null
  readonly frontmatter: Record<string, unknown>
  readonly tags: readonly string[]
  readonly publishedAt: string | null
  readonly updatedAt: string
}

/** The fields of a summary that a page may see, picked one by one so no other one travels. */
function summaryOf(entry: SummaryFields): PageSummary {
  return {
    id: entry.id,
    collection: entry.collection,
    locale: entry.locale,
    slug: entry.slug,
    translationGroup: entry.translationGroup,
    frontmatter: entry.frontmatter,
    tags: entry.tags,
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt,
  }
}

/**
 * The read side of a Hollware site for any app that renders on a server, whatever its framework: a React Router
 * loader, a Next.js Server Component, a TanStack Start server function. It reads published
 * content, through a service binding or over HTTP, and it never runs in the browser: a loader's
 * data goes there, and `PageEntry` holds only what a reader sees.
 *
 * ```ts
 * const hollware = createHollware({ site: 'my-site', reader: () => hollwareBinding(env.HOLLWARE) })
 * const answer = await hollware.getEntry('blog', 'en', slug, { request })
 * ```
 */
export function createHollware(options: HollwareOptions): Hollware {
  const { site } = options
  return {
    async getEntry(collection, locale, slug, getOptions = {}) {
      // A value that is not shaped like a token is never kept, wherever it comes from.
      const preview = isPreviewToken(getOptions.preview)
        ? getOptions.preview
        : previewTokenFromCookie(getOptions.request?.headers.get('cookie'))
      const answer = await readerOf(options).getEntry(site, collection, slug, locale, {
        formats: ['document'],
        ...(preview === undefined ? {} : { preview }),
      })
      if (answer.outcome === 'not_found' || answer.entry === undefined) return undefined
      const { document } = answer.entry
      return {
        entry: {
          ...summaryOf(answer.entry),
          ...(document === undefined ? {} : { document }),
        },
        preview: preview !== undefined,
      }
    },
    async listEntries(collection, listOptions = {}) {
      const page = await readerOf(options).listEntries(site, collection, listOptions)
      return { entries: page.entries.map(summaryOf), nextCursor: page.nextCursor }
    },
    async getTranslations(collection, group) {
      const answer = await readerOf(options).getTranslations(site, collection, group)
      return (answer.entries ?? []).map((entry) => ({ locale: entry.locale, slug: entry.slug }))
    },
    async search(query, searchOptions = {}) {
      const answer = await readerOf(options).search(site, query, searchOptions)
      return {
        mode: answer.mode,
        results: answer.results.map((result) => ({
          entry: summaryOf(result.entry),
          snippet: result.snippet,
          score: result.score,
          ...(result.passage === undefined ? {} : { passage: result.passage }),
        })),
      }
    },
    async describeSite() {
      return (await readerOf(options).describeSite(site)).site
    },
  }
}
