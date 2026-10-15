import {
  defineCollection,
  defineConfig,
  resolveConfig,
  type HollwareConfig,
  type ResolvedSite,
} from '@hollware/core'
import { env, exports, tracing } from 'cloudflare:workers'
import * as z from 'zod'
import { createHollwareWith } from '../../src/compose.ts'
import type { HollwareEnv, HollwareWorker } from '../../src/index.ts'
import type { McpEndpoint } from '../../src/mcp/index.ts'
import type { Clock } from '../../src/ports.ts'
import { fakeHandlers, type Overrides, type Seen } from '../mcp/support.ts'

/**
 * What the tests of the gateway and of the RPC entrypoint stand on: a config of their own, fake
 * handlers (the real ones belong to another work package), a clock the test moves, an execution
 * context that keeps what is handed to `waitUntil`, and a view of D1 that records which handle
 * (the binding, or a replica session) every statement went through. D1 itself is the real one.
 */

/** The one site of the test config. */
export const SITE_KEY = 'gateway-tests'

/** The site of another deployment: its tokens are in the same database and must not work here. */
export const OTHER_SITE_KEY = 'other-site'

export const HOST = 'hollware.test'
export const PUBLIC_URL = `https://${HOST}`

export const CONFIG = defineConfig({
  sites: {
    [SITE_KEY]: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      collections: {
        blog: defineCollection({
          schema: z.object({ title: z.string().min(1) }),
          routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
        }),
      },
      styleGuide: 'Plain words, short sentences.',
    },
  },
})

/** The site as the config resolves it. */
export const SITE: ResolvedSite = (() => {
  const site = resolveConfig(CONFIG).sites.get(SITE_KEY)
  if (site === undefined) throw new Error('the test config has no site')
  return site
})()

/** The time the tests start at: every instant they check is written out next to it. */
export const NOW = '2026-10-13T12:00:00.000Z'

export interface TestClock extends Clock {
  /** Moves the clock to this instant, ISO 8601 in UTC. */
  set(iso: string): void
}

/** A clock that tells the time the test says, and a new `Date` every time it is asked. */
export function testClock(start: string = NOW): TestClock {
  let current = new Date(start)
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = new Date(iso)
    },
  }
}

/**
 * An execution context that keeps the promises handed to `waitUntil`, so that a test can tell
 * that one was handed over, and wait for it. The rest is the runtime's own.
 */
export function fakeContext() {
  const waited: Promise<unknown>[] = []
  const ctx: ExecutionContext = {
    waitUntil: (promise) => {
      waited.push(promise)
    },
    passThroughOnException: () => {},
    exports,
    props: {},
    tracing,
    abort: () => {},
  }
  return { ctx, waited }
}

// ---- D1, watched -----------------------------------------------------------------------------

/** One statement and the handle it was prepared on. */
export interface Query {
  /** `primary` is the D1 binding itself; `session` is what `withSession` returned. */
  readonly via: 'primary' | 'session'
  readonly sql: string
}

export interface WatchedDb {
  readonly db: D1Database
  /** Every statement prepared, in order. */
  readonly queries: Query[]
  /** The constraint of every `withSession`, in order. */
  readonly sessions: string[]
}

/** The real D1, with a record of how it was reached. Everything is passed on as it came. */
export function watchDb(db: D1Database): WatchedDb {
  const queries: Query[] = []
  const sessions: string[] = []
  const watched: D1Database = {
    prepare: (sql) => {
      queries.push({ via: 'primary', sql })
      return db.prepare(sql)
    },
    batch: <T = unknown>(statements: D1PreparedStatement[]) => db.batch<T>(statements),
    exec: (sql) => db.exec(sql),
    dump: () => db.dump(),
    withSession: (constraint) => {
      sessions.push(String(constraint))
      const session = db.withSession(constraint)
      return {
        prepare: (sql) => {
          queries.push({ via: 'session', sql })
          return session.prepare(sql)
        },
        batch: <T = unknown>(statements: D1PreparedStatement[]) => session.batch<T>(statements),
        getBookmark: () => session.getBookmark(),
      }
    },
  }
  return { db: watched, queries, sessions }
}

/** A database whose every statement fails, the way D1 fails when it is down: when it runs. */
export function brokenDb(failure: Error): D1Database {
  const fail = async (): Promise<never> => {
    throw failure
  }
  const statement: D1PreparedStatement = {
    bind: () => statement,
    first: fail,
    run: fail,
    all: fail,
    raw: fail,
  }
  return {
    prepare: () => statement,
    batch: fail,
    exec: fail,
    dump: fail,
    withSession: () => ({ prepare: () => statement, batch: fail, getBookmark: () => null }),
  }
}

// ---- the log ---------------------------------------------------------------------------------

/** The `console.log` a capture replaced, until `restoreLogs` puts it back. */
let original: typeof console.log | null = null

/**
 * Collects what the Worker writes with `console.log`, every call as the one JSON line it must be.
 * A line that is not JSON stays a string, so that a test sees it. The test file calls
 * `restoreLogs` after each test (`afterEach`): this file cannot import the test runner, which is
 * a different one in workerd.
 */
export function captureLogs() {
  restoreLogs()
  original = console.log
  const lines: string[] = []
  console.log = (...args: unknown[]) => {
    lines.push(String(args[0]))
  }
  return {
    entries: (): unknown[] =>
      lines.map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return line
        }
      }),
    lines: (): string[] => [...lines],
  }
}

/** Puts back the `console.log` that `captureLogs` replaced; nothing to do when it did not. */
export function restoreLogs(): void {
  if (original === null) return
  console.log = original
  original = null
}

// ---- the Worker --------------------------------------------------------------------------------

/** An environment as a deployment can get it wrong: the variable missing, or not a URL. */
export function envWith(db: D1Database, publicUrl: unknown): HollwareEnv {
  return {
    DB: db,
    OAUTH_KV: env.OAUTH_KV,
    ...JSON.parse(JSON.stringify({ HOLLWARE_PUBLIC_URL: publicUrl })),
  }
}

export interface SendOptions {
  readonly method?: string
  /** Sent as `Authorization: Bearer <token>`. */
  readonly token?: string
  readonly headers?: Readonly<Record<string, string>>
  /** The Host header. The public URL's own by default, and none at all for `null`. */
  readonly host?: string | null
  readonly body?: string
}

export interface BootOptions {
  readonly overrides?: Overrides
  readonly outcomes?: Parameters<typeof fakeHandlers>[1]
  /** Instead of the real D1 (watched). */
  readonly db?: D1Database
  /** The `HOLLWARE_PUBLIC_URL` of the environment; leave it out for the right one. */
  readonly publicUrl?: unknown
  readonly now?: string
  /** Instead of the test config: one with `auth`, say. */
  readonly config?: HollwareConfig
  /** The static assets of the Worker, which hold the admin; none by default. */
  readonly assets?: Fetcher
  /** More bindings and variables of the Worker, such as `ANALYTICS`. */
  readonly bindings?: Partial<HollwareEnv>
}

/** The Worker of the test config over fake handlers and the real D1, and the means to drive it. */
export function boot(options: BootOptions = {}) {
  const { handlers, seen } = fakeHandlers(options.overrides, options.outcomes)
  const clock = testClock(options.now)
  const worker: HollwareWorker = createHollwareWith(options.config ?? CONFIG, handlers, { clock })
  const watched = watchDb(env.DB)
  const db = options.db ?? watched.db
  const environment: HollwareEnv = {
    ...envWith(db, 'publicUrl' in options ? options.publicUrl : PUBLIC_URL),
    ...(options.assets === undefined ? {} : { ASSETS: options.assets }),
    ...options.bindings,
  }
  const { ctx, waited } = fakeContext()

  /** One request through `fetch`, with the Host the runtime would put on it. */
  const sendRequest = (request: Request, send: Pick<SendOptions, 'host' | 'token'> = {}) => {
    const headers = new Headers(request.headers)
    const host = send.host === undefined ? HOST : send.host
    if (host !== null) headers.set('host', host)
    if (send.token !== undefined) headers.set('authorization', `Bearer ${send.token}`)
    return worker.fetch(new Request(request, { headers }), environment, ctx)
  }

  const send = (path: string, sending: SendOptions = {}) =>
    sendRequest(
      new Request(new URL(path, PUBLIC_URL), {
        method: sending.method ?? 'GET',
        headers: sending.headers ?? {},
        ...(sending.body === undefined ? {} : { body: sending.body }),
      }),
      sending,
    )

  /** The MCP endpoint as a client sees it, which is the Worker: the token goes in its headers. */
  const endpoint = (token?: string): McpEndpoint => ({
    fetch: (request) => sendRequest(request, token === undefined ? {} : { token }),
  })

  return {
    worker,
    env: environment,
    ctx,
    waited,
    clock,
    seen,
    queries: watched.queries,
    sessions: watched.sessions,
    send,
    sendRequest,
    endpoint,
    /** Waits for everything the Worker handed to `waitUntil`. */
    settle: async () => {
      await Promise.all(waited)
    },
  }
}

export type Booted = ReturnType<typeof boot>

/** What an answer looks like on the wire, whole. */
export async function wire(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

/** The error a promise rejects with; a promise that resolves is a failed test. */
export async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('the call was expected to fail, and it answered')
}

/** The one call the handlers recorded; any other count is a failed test. */
export function onlyCall(seen: readonly Seen[]): Seen {
  const [call, ...rest] = seen
  if (call === undefined || rest.length > 0) {
    throw new Error(`expected exactly one call of a handler, found ${seen.length}`)
  }
  return call
}
