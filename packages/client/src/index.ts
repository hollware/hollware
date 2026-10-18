import type { describeSite, getEntry, getTranslations, listEntries, search } from '@hollware/core'
import type * as z from 'zod'

export { signWebhook, verifyWebhook, type WebhookCheck } from '@hollware/core'
export {
  clearedPreviewCookie,
  exchangeHeaders,
  exchangePreviewLink,
  isPreviewRefusal,
  isPreviewToken,
  isSecureRequest,
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_MAX_AGE,
  previewCookie,
  previewTokenFromCookie,
  type PreviewExchange,
} from './preview.ts'

export {
  createHollware,
  type EntryAnswer,
  type EntryPage,
  type GetEntryOptions,
  type Hollware,
  type HollwareOptions,
  type ListEntriesOptions,
  type PageDocument,
  type PageEntry,
  type PageSummary,
  type ReaderOptions,
  type Translation,
} from './hollware.ts'
export {
  isPreviewRequest,
  previewCookieClear,
  previewHeaders,
  previewRedirect,
} from './preview-request.ts'

export const name = '@hollware/client'

type Output<Spec extends { output: z.ZodType }> = z.output<Spec['output']>

export type Format = 'markdown' | 'document' | 'html'

/** How a search is made: by its words, by meaning, or both merged. */
export type SearchMode = 'fulltext' | 'semantic' | 'hybrid'

/**
 * What a site reads from Hollware: the published content, through the five read methods. A
 * service binding to a Hollware Worker already has this shape; `createClient` gives the same over
 * HTTP, so a site can move from one transport to the other without changing a call.
 */
export interface HollwareReader {
  getEntry(
    site: string,
    collection: string,
    slug: string,
    locale: string,
    options?: {
      readonly formats?: readonly Format[]
      readonly related?: boolean
      /**
       * A preview token (`hw_prv_…`, made in the admin, or the `hollware-preview` of a page's
       * URL): the entry it names is read in its latest revision, a draft included, and the answer
       * must never be cached. A token that does not hold is an `invalid_preview` error (a
       * `HollwareClientError` over HTTP), never the published version in its place.
       */
      readonly preview?: string
    },
  ): Promise<Output<typeof getEntry>>
  listEntries(
    site: string,
    collection: string,
    options?: {
      readonly locale?: string
      readonly tag?: string
      readonly limit?: number
      readonly cursor?: string
    },
  ): Promise<Output<typeof listEntries>>
  getTranslations(
    site: string,
    collection: string,
    translationGroup: string,
  ): Promise<Output<typeof getTranslations>>
  describeSite(site: string): Promise<Output<typeof describeSite>>
  /** The published entries that match `query`, best first: by its words, by meaning, or both. */
  search(
    site: string,
    query: string,
    options?: {
      readonly collection?: string
      readonly locale?: string
      readonly limit?: number
      readonly mode?: SearchMode
    },
  ): Promise<Output<typeof search>>
}

export type ClientOptions =
  /** A service binding to the `Hollware` entrypoint of a Hollware Worker. */
  | { readonly binding: HollwareReader }
  /** The public URL of a Hollware, and a read token (`hw_read_`) or a personal token with `content:read`. */
  | {
      readonly url: string
      readonly token: string
      /** `fetch`, when not the global one. */
      readonly fetch?: (request: Request) => Promise<Response>
    }

/** An answer of the HTTP read API that is no result: its code, message and fix. */
export class HollwareClientError extends Error {
  readonly status: number
  readonly code: string
  readonly fix: string | null

  constructor(status: number, code: string, message: string, fix: string | null) {
    super(message)
    this.name = 'HollwareClientError'
    this.status = status
    this.code = code
    this.fix = fix
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function httpReader(url: string, token: string, send: (request: Request) => Promise<Response>) {
  const base = url.replace(/\/+$/, '')
  async function get(
    path: string,
    query: Record<string, string | undefined> = {},
  ): Promise<unknown> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value)
    }
    const search = params.toString()
    const response = await send(
      new Request(`${base}/v1/${path}${search === '' ? '' : `?${search}`}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      }),
    )
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 200 || response.status === 404) {
      if (isRecord(body) && typeof body['outcome'] === 'string') return body
    }
    const field = (key: string) =>
      isRecord(body) && typeof body[key] === 'string' ? body[key] : null
    throw new HollwareClientError(
      response.status,
      field('code') ?? 'http_error',
      field('message') ?? `Hollware answered ${response.status}`,
      field('fix'),
    )
  }
  const segment = encodeURIComponent
  // The read API answers with the outputs of the operations, which the types above describe.
  const reader = {
    getEntry: (
      _site: string,
      collection: string,
      slug: string,
      locale: string,
      options?: {
        readonly formats?: readonly Format[]
        readonly related?: boolean
        readonly preview?: string
      },
    ) =>
      get(`${segment(collection)}/${segment(locale)}/${segment(slug)}`, {
        formats: options?.formats?.join(','),
        related: options?.related === true ? 'true' : undefined,
        preview: options?.preview,
      }),
    listEntries: (
      _site: string,
      collection: string,
      options: { locale?: string; tag?: string; limit?: number; cursor?: string } = {},
    ) =>
      get(segment(collection), {
        locale: options.locale,
        tag: options.tag,
        limit: options.limit === undefined ? undefined : String(options.limit),
        cursor: options.cursor,
      }),
    getTranslations: (_site: string, collection: string, group: string) =>
      get(`${segment(collection)}/translations/${segment(group)}`),
    describeSite: (_site: string) => get('site'),
    search: (
      _site: string,
      query: string,
      options: { collection?: string; locale?: string; limit?: number; mode?: SearchMode } = {},
    ) =>
      get('search', {
        q: query,
        collection: options.collection,
        locale: options.locale,
        limit: options.limit === undefined ? undefined : String(options.limit),
        mode: options.mode,
      }),
  }
  return reader
}

/**
 * A reader of a Hollware: over a service binding, which needs no network and no token, or over
 * HTTP, through the read API at `<url>/v1`. A token is of one site: the `site` argument of the
 * HTTP reader is that site's key.
 */
export function createClient(options: ClientOptions): HollwareReader {
  if ('binding' in options) return options.binding
  const send = options.fetch ?? ((request: Request) => fetch(request))
  const reader = httpReader(options.url, options.token, send)
  return {
    getEntry: async (...args) => narrow(await reader.getEntry(...args)),
    listEntries: async (...args) => narrow(await reader.listEntries(...args)),
    getTranslations: async (...args) => narrow(await reader.getTranslations(...args)),
    describeSite: async (...args) => narrow(await reader.describeSite(...args)),
    search: async (...args) => narrow(await reader.search(...args)),
  }
}

/** The body of an answer, which the read API builds from the output schema of its operation. */
function narrow<T>(body: unknown): T {
  return body as T
}

function isReader(value: unknown): value is HollwareReader {
  return typeof value === 'object' && value !== null && 'getEntry' in value
}

/**
 * A service binding to the `Hollware` entrypoint as a reader. `wrangler types` cannot see across
 * Workers, so the binding comes typed as `Service`: this checks it is there, and gives the
 * mistake a name when it is not. `@hollware/astro`, `@hollware/react` and `@hollware/vue` re-export it.
 */
export function hollwareBinding(binding: unknown, name = 'HOLLWARE'): HollwareReader {
  if (isReader(binding)) return binding
  throw new Error(
    `Hollware: the Worker has no service binding ${name} to the Hollware entrypoint: add it to services in wrangler.jsonc.`,
  )
}
