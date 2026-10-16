import {
  describeSite as describeSiteSpec,
  getEntry as getEntrySpec,
  getTranslations as getTranslationsSpec,
  HollwareError,
  listEntries as listEntriesSpec,
  search as searchSpec,
  type ErrorCode,
  type ResolvedSite,
} from '@hollware/core'
import type * as z from 'zod'
import type { Principal } from '../auth/types.ts'
import { createD1Store } from '../db/index.ts'
import type { HollwareEnv, HollwareRpc } from '../index.ts'
import { describeError } from '../mcp/errors.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'
import type { Clock } from '../ports.ts'
import { semanticOfEnv } from '../semantic/cloudflare.ts'

/** A call over RPC that failed in a way its caller does not get to see. */
export interface RpcLogEntry {
  readonly kind: 'rpc_error'
  /** Also in the fix of the `internal` error the caller got, so that the operator finds this line. */
  readonly requestId: string
  /** The method of `HollwareRpc` that was called. */
  readonly method: string
  readonly errorCode: ErrorCode | null
  /** The error and its causes: what the caller never sees. */
  readonly detail: string
}

/** What the four methods stand on, built once for the isolate. */
export interface RpcDeps {
  /** The sites this deployment serves, by key; a call names one of them. */
  readonly sites: ReadonlyMap<string, ResolvedSite>
  /** Brings `sites` in line with D1 before a call reads it (ADR-033); none in tests of a fixed map. */
  readonly refresh?: (db: D1Database) => Promise<void>
  readonly handlers: Handlers
  readonly clock: Clock
  readonly log: (entry: RpcLogEntry) => void
}

/** What a call needs of the bindings of the invocation. */
export type RpcEnv = Pick<HollwareEnv, 'DB' | 'AI' | 'VECTORIZE'>

/**
 * Who calls over RPC: a Worker of the same account, which reads published content and nothing
 * else. Frozen, so that no handler can widen it for the calls that come after.
 */
const BINDING_PRINCIPAL: Principal = Object.freeze({
  kind: 'binding',
  scopes: Object.freeze(['content:read'] as const),
} as const)

/**
 * The site of a call is none of the sites of this deployment. The message and the fix both say
 * which sites it serves, for a caller that only gets one of them.
 */
function unknownSite(site: string, served: Iterable<string>): HollwareError {
  const keys = [...served].map((key) => `"${key}"`).join(', ')
  return new HollwareError(
    'invalid_input',
    `This Hollware serves no site "${site}": it serves ${keys}.`,
    `Pass one of ${keys}, the sites this deployment serves, as the site argument.`,
  )
}

/**
 * The options object of a call, without the keys that hold `undefined`, so that the handler sees
 * the same input as over MCP. A key that is none of `allowed` is an error: the specs are strict
 * objects so that a misspelled field is not ignored, and a caller that writes `lcoale` would
 * otherwise get every locale. Only the keys of `HollwareRpc` get through, so an input the RPC
 * does not offer, such as the `status` of `list_entries`, can never be set.
 */
function readOptions(
  options: object | null | undefined,
  allowed: readonly string[],
): Record<string, unknown> {
  if (options === undefined || options === null) return {}
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new HollwareError(
      'invalid_input',
      'The options of the call are not an object.',
      `Pass an object with only these options: ${allowed.join(', ')}, or none.`,
    )
  }
  const entries = Object.entries(options)
  const unknown = entries.map(([key]) => key).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new HollwareError(
      'invalid_input',
      `The call has options that Hollware does not know: ${unknown.join(', ')}.`,
      `Pass only these options: ${allowed.join(', ')}.`,
    )
  }
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined))
}

/**
 * The input of an operation, parsed by its spec: the defaults (`limit`, `formats`) apply and a
 * value that breaks the schema is `invalid_input` that says which.
 */
function parseInput<Schema extends z.ZodType>(schema: Schema, raw: unknown): z.output<Schema> {
  const parsed = schema.safeParse(raw)
  if (parsed.success) return parsed.data
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
  )
  throw new HollwareError(
    'invalid_input',
    `The arguments of the call are not valid. ${problems.join('; ')}.`,
    'Fix the arguments named above and call again. describeSite lists the collections and locales of the site.',
  )
}

/**
 * What a caller gets of a failure: an error it can read and act on, and none of the cause, which
 * an error carries when a handler wraps a failure of D1 or of its own. A `HollwareError` goes as
 * it is, rebuilt without its cause, and anything else is `internal` with the id of the call. What
 * the caller does not get goes to the log, under that id.
 */
function forCaller(
  deps: RpcDeps,
  requestId: string,
  method: string,
  error: unknown,
): HollwareError {
  const known = error instanceof HollwareError ? error : null
  if (known === null || known.cause !== undefined) {
    deps.log({
      kind: 'rpc_error',
      requestId,
      method,
      errorCode: known === null ? null : known.code,
      detail: describeError(error),
    })
  }
  if (known === null) {
    return new HollwareError(
      'internal',
      'The operation failed on the server.',
      `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
    )
  }
  return new HollwareError(known.code, known.message, known.fix)
}

/**
 * One call of an operation over RPC. In this order: the site is one of this deployment, the
 * input is built and parsed by the spec's schema, and the handler runs with
 *
 * - `view: 'published'`, so a draft is never read, and the principal `{ kind: 'binding', scopes:
 *   ['content:read'] }`, which can read and nothing else;
 * - a store over `env.DB.withSession('first-unconstrained')`: published content, from the nearest
 *   replica, where MCP reads the primary;
 * - the clock, `client: null` (a binding says nothing about itself) and a request id of its own.
 *
 * `build` makes the raw input, so a wrong site is answered before anything else is looked at and
 * a call that fails never opens a session.
 */
async function run<Schema extends z.ZodType, Output>(
  deps: RpcDeps,
  env: RpcEnv,
  method: string,
  site: string,
  schema: Schema,
  build: () => unknown,
  handler: (input: z.output<Schema>, context: OperationContext) => Promise<Output>,
): Promise<Output> {
  const requestId = crypto.randomUUID()
  try {
    await deps.refresh?.(env.DB)
  } catch (error) {
    // D1 down, say: the caller gets `internal` and a request id, as for a failed read.
    throw forCaller(deps, requestId, method, error)
  }
  const served = deps.sites.get(site)
  if (served === undefined) throw unknownSite(site, deps.sites.keys())
  const input = parseInput(schema, build())
  const context: OperationContext = {
    site: served,
    principal: BINDING_PRINCIPAL,
    view: 'published',
    store: createD1Store(env.DB.withSession('first-unconstrained')),
    clock: deps.clock,
    client: null,
    requestId,
    semantic: semanticOfEnv(env),
  }
  try {
    return await handler(input, context)
  } catch (error) {
    throw forCaller(deps, requestId, method, error)
  }
}

/**
 * The read-only RPC surface (`HollwareRpc`) over the bindings of one invocation. It is a function
 * and not the entrypoint so that it runs in any test; `entrypoint.ts` is the class that calls it.
 * It has the four methods and nothing that writes, and none of them reaches a handler other than
 * the one that reads.
 */
export function createRpc(deps: RpcDeps, env: RpcEnv): HollwareRpc {
  return {
    getEntry: (site, collection, slug, locale, options) =>
      run(
        deps,
        env,
        'getEntry',
        site,
        getEntrySpec.input,
        () => ({ collection, locale, slug, ...readOptions(options, ['formats', 'related']) }),
        deps.handlers.get_entry,
      ),
    listEntries: (site, collection, options) =>
      run(
        deps,
        env,
        'listEntries',
        site,
        listEntriesSpec.input,
        () => ({ collection, ...readOptions(options, ['locale', 'tag', 'limit', 'cursor']) }),
        deps.handlers.list_entries,
      ),
    getTranslations: (site, collection, translationGroup) =>
      run(
        deps,
        env,
        'getTranslations',
        site,
        getTranslationsSpec.input,
        () => ({ collection, translationGroup }),
        deps.handlers.get_translations,
      ),
    describeSite: (site) =>
      run(
        deps,
        env,
        'describeSite',
        site,
        describeSiteSpec.input,
        () => ({}),
        deps.handlers.describe_site,
      ),
    search: (site, query, options) =>
      run(
        deps,
        env,
        'search',
        site,
        searchSpec.input,
        () => ({ query, ...readOptions(options, ['collection', 'locale', 'limit', 'mode']) }),
        deps.handlers.search,
      ),
  }
}
