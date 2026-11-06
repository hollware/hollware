import type {
  describeSite,
  getEntry,
  getTranslations,
  listEntries,
  listRedirects,
  Navigation,
  ResolvedPath,
  search,
} from '@hollware/core'
import type * as z from 'zod'

export {
  flattenNavigation,
  signWebhook,
  trailOf,
  verifyWebhook,
  type Navigation,
  type NavigationEntry,
  type NavigationGroup,
  type ResolvedPath,
  type WebhookCheck,
} from '@hollware/core'
export {
  clearedPreviewCookie,
  exchangeHeaders,
  exchangePreviewLink,
  isPreviewRefusal,
  isSecureRequest,
  PREVIEW_COOKIE,
  previewTokenFromCookie,
  type PreviewExchange,
} from './preview.ts'

export {
  createHollware,
  imageOf,
  type CollectionNavigation,
  type EntryAnswer,
  type EntryPage,
  type GetEntryOptions,
  type Hollware,
  type HollwareOptions,
  type ImageAttributes,
  type ListEntriesOptions,
  type NavigationOptions,
  type PageAncestor,
  type PageAnswer,
  type PageDocument,
  type PageEntry,
  type PageImage,
  type PageSummary,
  type ReaderOptions,
  type SearchOptions,
  type SearchPage,
  type SiteDescription,
  type Translation,
} from './hollware.ts'
export {
  hollwareAgentBindingClient,
  hollwareAgentClient,
  type AgentClientOptions,
} from './agent.ts'
export {
  verifyAgentEvent,
  type AgentDelivery,
  type AgentGrant,
  type HollwareAgentRpc,
} from '@hollware/core'
export {
  createOpsClient,
  type OperationInput,
  type OperationOutput,
  type OpsBinding,
  type OpsClient,
  type OpsClientOptions,
} from './ops.ts'
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
 * What a site reads from Hollware: the published content, through the eight read methods. A
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
      /** Also the published entries the reference rules of the collection name, by field. */
      readonly references?: boolean
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
  /**
   * The published entries of a collection in a locale (the site's default when absent), grouped
   * and ordered as the collection's navigation says, for a sidebar: at most 1,000 of them.
   */
  getNavigation(
    site: string,
    collection: string,
    options?: { readonly locale?: string },
  ): Promise<Navigation>
  /**
   * The published entry a path of the site names, by the routes of its collections: its
   * collection, locale and slug, to read with `getEntry`. A path the entry had (an old slug, or the
   * old place of it or of an ancestor) answers `redirect` with the path it has now.
   */
  resolvePath(
    site: string,
    path: string,
    options?: {
      /** A preview token (`hw_prv_…`): drafts are resolved too. */
      readonly preview?: string
    },
  ): Promise<ResolvedPath>
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
      /** Also the section each result matched, with its heading and the URL of the entry. */
      readonly passages?: boolean
      /** The least score a match by meaning must reach, 0 to 1. */
      readonly minScore?: number
    },
  ): Promise<Output<typeof search>>
  /** The old paths of entries that moved, and where each goes now: what a site answers with a 301. */
  listRedirects(
    site: string,
    options?: {
      readonly collection?: string
      readonly locale?: string
      readonly limit?: number
      readonly cursor?: string
    },
  ): Promise<Output<typeof listRedirects>>
}

export type ClientOptions =
  | { readonly binding: HollwareReader }
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

type Shape = Readonly<Record<string, Readonly<Record<string, 'array' | 'object' | 'string'>>>>

const SHAPES = {
  getEntry: { ok: { entry: 'object' }, not_found: {} },
  listEntries: { ok: { entries: 'array' } },
  getTranslations: { ok: { entries: 'array' }, not_found: {} },
  getNavigation: { ok: { collection: 'string', locale: 'string', groups: 'array' } },
  resolvePath: {
    ok: { collection: 'string', locale: 'string', slug: 'string', path: 'string' },
    redirect: { collection: 'string', locale: 'string', slug: 'string', path: 'string' },
    not_found: {},
  },
  describeSite: { ok: { site: 'object' } },
  search: { ok: { results: 'array' } },
  listRedirects: { ok: { redirects: 'array' } },
} as const satisfies Readonly<Record<keyof HollwareReader, Shape>>

function fits(body: Record<string, unknown>, shape: Shape): boolean {
  const fields = shape[String(body['outcome'])]
  if (fields === undefined) return false
  return Object.entries(fields).every(([key, kind]) => {
    const value = body[key]
    return kind === 'array'
      ? Array.isArray(value)
      : kind === 'object'
        ? isRecord(value)
        : typeof value === kind
  })
}

function httpReader(url: string, token: string, send: (request: Request) => Promise<Response>) {
  const base = withoutTrailingSlashes(url)
  async function get(
    path: string,
    shape: Shape,
    query: Record<string, string | undefined> = {},
    preview?: string,
  ): Promise<unknown> {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value)
    }
    const search = params.toString()
    const response = await send(
      new Request(`${base}/v1/${path}${search === '' ? '' : `?${search}`}`, {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/json',
          ...(preview === undefined ? {} : { 'hollware-preview': preview }),
        },
      }),
    )
    const body: unknown = await response.json().catch(() => null)
    if (response.status === 200 || response.status === 404) {
      if (isRecord(body) && typeof body['outcome'] === 'string') {
        if (fits(body, shape)) return body
        throw new HollwareClientError(
          response.status,
          'invalid_response',
          `Hollware answered ${path} with a body this client does not know.`,
          'Use a version of @hollware/client that matches the version of the Hollware it reads.',
        )
      }
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
  const reader = {
    getEntry: (
      _site: string,
      collection: string,
      slug: string,
      locale: string,
      options?: {
        readonly formats?: readonly Format[]
        readonly related?: boolean
        readonly references?: boolean
        readonly preview?: string
      },
    ) =>
      get(
        `${segment(collection)}/${segment(locale)}/${segment(slug)}`,
        SHAPES.getEntry,
        {
          formats: options?.formats?.join(','),
          related: options?.related === true ? 'true' : undefined,
          references: options?.references === true ? 'true' : undefined,
        },
        options?.preview,
      ),
    listEntries: (
      _site: string,
      collection: string,
      options: { locale?: string; tag?: string; limit?: number; cursor?: string } = {},
    ) =>
      get(segment(collection), SHAPES.listEntries, {
        locale: options.locale,
        tag: options.tag,
        limit: options.limit === undefined ? undefined : String(options.limit),
        cursor: options.cursor,
      }),
    getTranslations: (_site: string, collection: string, group: string) =>
      get(`${segment(collection)}/translations/${segment(group)}`, SHAPES.getTranslations),
    getNavigation: (_site: string, collection: string, options: { locale?: string } = {}) =>
      get(`${segment(collection)}/navigation`, SHAPES.getNavigation, { locale: options.locale }),
    resolvePath: (_site: string, path: string, options: { preview?: string } = {}) =>
      get('resolve', SHAPES.resolvePath, { path }, options.preview),
    describeSite: (_site: string) => get('site', SHAPES.describeSite),
    search: (
      _site: string,
      query: string,
      options: {
        collection?: string
        locale?: string
        limit?: number
        mode?: SearchMode
        passages?: boolean
        minScore?: number
      } = {},
    ) =>
      get('search', SHAPES.search, {
        q: query,
        collection: options.collection,
        locale: options.locale,
        limit: options.limit === undefined ? undefined : String(options.limit),
        mode: options.mode,
        passages: options.passages === true ? 'true' : undefined,
        minScore: options.minScore === undefined ? undefined : String(options.minScore),
      }),
    listRedirects: (
      _site: string,
      options: { collection?: string; locale?: string; limit?: number; cursor?: string } = {},
    ) =>
      get('redirects', SHAPES.listRedirects, {
        collection: options.collection,
        locale: options.locale,
        limit: options.limit === undefined ? undefined : String(options.limit),
        cursor: options.cursor,
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
    getNavigation: async (...args) => narrow(await reader.getNavigation(...args)),
    resolvePath: async (...args) => narrow(await reader.resolvePath(...args)),
    describeSite: async (...args) => narrow(await reader.describeSite(...args)),
    search: async (...args) => narrow(await reader.search(...args)),
    listRedirects: async (...args) => narrow(await reader.listRedirects(...args)),
  }
}

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

function withoutTrailingSlashes(text: string): string {
  let end = text.length
  while (end > 0 && text[end - 1] === '/') end--
  return text.slice(0, end)
}
