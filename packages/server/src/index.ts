import type {
  describeSite,
  getEntry,
  getTranslations,
  HollwareConfig,
  listEntries,
} from '@hollware/core'
import type { WorkerEntrypoint } from 'cloudflare:workers'
import type * as z from 'zod'
import { createHollwareWith } from './compose.ts'
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

/** The bindings and variables of the Worker, as its `wrangler.jsonc` declares them. */
export interface HollwareEnv {
  /** The D1 database, with the migrations of this package applied. */
  readonly DB: D1Database
  /**
   * The public URL of the Worker, such as `https://cms.example.com`. It is the only Host and
   * Origin the Worker answers; without it, every request fails.
   */
  readonly HOLLWARE_PUBLIC_URL: string
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
    options?: { readonly formats?: readonly ('markdown' | 'document' | 'html')[] },
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
}

/**
 * What `createHollware(config)` returns. The user's Worker is
 * `export default { fetch }` and `export class Hollware extends hollware.Hollware {}`.
 */
export interface HollwareWorker {
  /** MCP at `/mcp`, and the other routes of the gateway. */
  readonly fetch: (request: Request, env: HollwareEnv, ctx: ExecutionContext) => Promise<Response>
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

/** Builds the Worker from the config. The config is resolved once, when the Worker starts. */
export type CreateHollware = (config: HollwareConfig) => HollwareWorker

/**
 * Builds the Worker from the config: `const hollware = createHollware(config)`, then
 * `export default { fetch: hollware.fetch }` and `export class Hollware extends hollware.Hollware {}`.
 * The config is resolved once, here; a broken one throws its `ConfigError`.
 */
export const createHollware: CreateHollware = (config) => createHollwareWith(config, handlers)
