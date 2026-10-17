import type {
  describeSite,
  getEntry,
  getTranslations,
  HollwareConfig,
  listEntries,
  search,
} from '@hollware/core'
import type { WorkerEntrypoint } from 'cloudflare:workers'
import type * as z from 'zod'
import { createHollwareWith } from './compose.ts'
import type { EventDelivery, EventQueue } from './events/run.ts'
import { handlers } from './ops/index.ts'

export const name = '@hollware/server'

export {
  defineHandlers,
  type Handlers,
  type OperationContext,
  type OperationHandler,
} from './ops/types.ts'
export type { Principal } from './auth/types.ts'
export {
  MAX_BOUND_PARAMETERS,
  MAX_ROW_BYTES,
  OPERATION_TIMEOUT_MS,
  OUTPUT_CAP_BYTES,
} from './limits.ts'
export type * from './ports.ts'
export type { EventMessage } from './events/run.ts'

/** The bindings and variables of the Worker, as its `wrangler.jsonc` declares them. */
export interface HollwareEnv {
  /** The D1 database, with the migrations of this package applied. */
  readonly DB: D1Database
  /**
   * The public URL of the Worker, such as `https://cms.example.com`. It is the only Host and
   * Origin the Worker answers; without it, every request fails.
   */
  readonly HOLLWARE_PUBLIC_URL: string
  /**
   * The key that seals the secrets Hollware makes for the structure, such as those that sign
   * webhooks (ADR-033): at least 32 characters, which `hollware deploy` makes when it is missing.
   */
  readonly HOLLWARE_SECRET?: string
  /**
   * The KV namespace of the OAuth server (ADR-026): its clients, grants and tokens, all by hash.
   * Personal tokens work without it; OAuth does not.
   */
  readonly OAUTH_KV: KVNamespace
  /**
   * A Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc): with it, the routes anyone
   * may call without a token (sign-in and passkeys, OAuth's token and registration, the beacon)
   * answer 429 past its limit, per address and route (T-10 of docs/security/threat-model.md).
   * Without it, nothing is limited.
   */
  readonly HOLLWARE_RATE_LIMIT?: RateLimiter
  /** The static assets of the Worker, which hold the admin at `/admin/`; without them, no admin. */
  readonly ASSETS?: Fetcher
  /** The Queue of publication events (ADR-025); without it, the cron trigger delivers them. */
  readonly EVENTS?: EventQueue
  /**
   * Workers AI and a Vectorize index (v0.5): with both, every published entry is embedded and
   * `search` can be semantic; without either, search is full text only.
   */
  readonly AI?: Ai
  /** `wrangler types` names a Vectorize binding `VectorizeIndex`; either works. */
  readonly VECTORIZE?: Vectorize | VectorizeIndex
  /** The embedding model of Workers AI, `@cf/baai/bge-m3` when not set; its index must match it. */
  readonly HOLLWARE_EMBEDDING_MODEL?: string
  /**
   * Analytics (ADR-031): the Analytics Engine dataset that the beacon of the sites writes to, and
   * what `content_stats` reads it with: the account, an API token with Account Analytics Read
   * (a secret), and the dataset's name when it is not `hollware_page_views`.
   */
  readonly ANALYTICS?: AnalyticsEngineDataset
  readonly HOLLWARE_ANALYTICS_ACCOUNT_ID?: string
  readonly HOLLWARE_ANALYTICS_TOKEN?: string
  readonly HOLLWARE_ANALYTICS_DATASET?: string
  /**
   * The agents of @hollware/agents (v0.6), over a service binding to their named entrypoint: the
   * cron trigger of Hollware wakes them every ten minutes, so they need no cron trigger of their
   * own (the free plan has five for the account). `wrangler types` writes it as a plain
   * `Service`, as it cannot see the agents' entrypoint, so any binding goes in: one without `run`
   * is not called.
   */
  readonly AGENTS?: object
}

type Output<Spec extends { output: z.ZodType }> = z.output<Spec['output']>

/**
 * The read-only RPC surface that sites of the same account call over a service binding. It
 * returns published content only; nothing in it writes.
 */
export interface HollwareRpc {
  getEntry(
    site: string,
    collection: string,
    slug: string,
    locale: string,
    options?: {
      readonly formats?: readonly ('markdown' | 'document' | 'html')[]
      /** Also the published entries closest by meaning (ADR-030). */
      readonly related?: boolean
      /**
       * A preview token (`hw_prv_…`, made in the admin): the entry it names is read in its latest
       * revision, a draft included. A token that does not hold (expired, of another site or
       * entry, forged) is an `invalid_input` error, never the published version in its place.
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
      readonly mode?: 'fulltext' | 'semantic' | 'hybrid'
    },
  ): Promise<Output<typeof search>>
}

/**
 * What `createHollware(config)` returns. The user's Worker is
 * `export default { fetch }` and `export class Hollware extends hollware.Hollware {}`.
 */
export interface HollwareWorker {
  /** MCP at `/mcp`, and the other routes of the gateway. */
  readonly fetch: (request: Request, env: HollwareEnv, ctx: ExecutionContext) => Promise<Response>
  /** The consumer of the events Queue (`queues.consumers` in wrangler.jsonc). */
  readonly queue: (
    batch: { readonly messages: readonly EventDelivery[] },
    env: HollwareEnv,
    ctx: ExecutionContext,
  ) => Promise<void>
  /** The cron trigger of the project (`triggers.crons` in wrangler.jsonc, every minute). */
  readonly scheduled: (
    controller: ScheduledController,
    env: HollwareEnv,
    ctx: ExecutionContext,
  ) => Promise<void>
  /** The RPC entrypoint, for the user's Worker to export under the name `Hollware`. */
  readonly Hollware: new (
    ctx: ExecutionContext,
    env: HollwareEnv,
  ) => WorkerEntrypoint<HollwareEnv> & HollwareRpc
}

/**
 * Builds the Worker. The sites live in D1 (ADR-033); a config of 0.x, when given, is moved there
 * on the first request, for the sites that have no definition yet, and never read again.
 */
export type CreateHollware = (config?: HollwareConfig) => HollwareWorker

/**
 * Builds the Worker from the config: `const hollware = createHollware(config)`, then
 * `export default { fetch: hollware.fetch }` and `export class Hollware extends hollware.Hollware {}`.
 * The config is resolved once, here; a broken one throws its `ConfigError`.
 */
export const createHollware: CreateHollware = (config) => createHollwareWith(config, handlers)

/** What a Workers Rate Limiting binding answers: whether one more request for `key` fits. */
export interface RateLimiter {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}
