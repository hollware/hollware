import {
  definitionsFromConfig,
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
import type { Handlers } from '../../src/ops/types.ts'
import type { Clock } from '../../src/ports.ts'
import { fakeHandlers, type Overrides, type Seen } from '../mcp/support.ts'

export const SITE_KEY = 'gateway-tests'

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

export const SITE: ResolvedSite = (() => {
  const site = resolveConfig(CONFIG).sites.get(SITE_KEY)
  if (site === undefined) throw new Error('the test config has no site')
  return site
})()

export const NOW = '2026-10-13T12:00:00.000Z'

export interface TestClock extends Clock {
  set(iso: string): void
}

export function testClock(start: string = NOW): TestClock {
  let current = new Date(start)
  return {
    now: () => new Date(current),
    set: (iso) => {
      current = new Date(iso)
    },
  }
}

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

export interface Query {
  readonly via: 'primary' | 'session'
  readonly sql: string
}

export interface WatchedDb {
  readonly db: D1Database
  readonly queries: Query[]
  readonly sessions: string[]
}

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

let original: typeof console.log | null = null

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

export function restoreLogs(): void {
  if (original === null) return
  console.log = original
  original = null
}

export function envWith(db: D1Database, publicUrl: unknown): HollwareEnv {
  return {
    DB: db,
    OAUTH_KV: env.OAUTH_KV,
    ...JSON.parse(JSON.stringify({ HOLLWARE_PUBLIC_URL: publicUrl })),
  }
}

export interface SendOptions {
  readonly method?: string
  readonly token?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly host?: string | null
  readonly body?: string
}

export interface BootOptions {
  readonly handlers?: Handlers
  readonly overrides?: Overrides
  readonly outcomes?: Parameters<typeof fakeHandlers>[1]
  readonly db?: D1Database
  readonly publicUrl?: unknown
  readonly now?: string
  readonly config?: HollwareConfig
  readonly assets?: Fetcher
  readonly bindings?: Partial<HollwareEnv>
  readonly admin?: HollwareConfig['admin']
  readonly secrets?: Readonly<Record<string, string>>
}

export async function defineSites(db: D1Database, config: HollwareConfig, now: string) {
  const definitions = definitionsFromConfig(config)
  const keys = Object.keys(definitions)
  await db.batch([
    ...Object.entries(definitions).map(([key, definition]) =>
      db
        .prepare(
          `INSERT INTO sites (id, definition, version, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)
           ON CONFLICT (id) DO UPDATE SET definition = excluded.definition, version = sites.version + 1, deleted_at = NULL, updated_at = excluded.updated_at`,
        )
        .bind(key, JSON.stringify(definition), now),
    ),
    db
      .prepare(
        `UPDATE sites SET deleted_at = ?1, version = version + 1 WHERE deleted_at IS NULL AND id NOT IN (${keys.map((_, index) => `?${index + 2}`).join(', ')})`,
      )
      .bind(now, ...keys),
  ])
}

export function boot(options: BootOptions = {}) {
  const { handlers: fake, seen } = fakeHandlers(options.overrides, options.outcomes)
  const handlers = options.handlers ?? fake
  const clock = testClock(options.now)
  const config = options.config ?? CONFIG
  const worker: HollwareWorker = createHollwareWith(
    config.auth === undefined && options.admin === undefined
      ? undefined
      : {
          ...(config.auth === undefined ? {} : { auth: config.auth }),
          ...(options.admin === undefined ? {} : { admin: options.admin }),
        },
    handlers,
    { clock },
  )
  let ready: Promise<void> | undefined
  const prepare = () => (ready ??= defineSites(env.DB, config, clock.now().toISOString()))
  const watched = watchDb(env.DB)
  const db = options.db ?? watched.db
  const environment: HollwareEnv = {
    ...envWith(db, 'publicUrl' in options ? options.publicUrl : PUBLIC_URL),
    ...(options.assets === undefined ? {} : { ASSETS: options.assets }),
    ...options.bindings,
    ...options.secrets,
  }
  const { ctx, waited } = fakeContext()

  const sendRequest = (request: Request, send: Pick<SendOptions, 'host' | 'token'> = {}) => {
    const headers = new Headers(request.headers)
    const host = send.host === undefined ? HOST : send.host
    if (host !== null) headers.set('host', host)
    if (send.token !== undefined) headers.set('authorization', `Bearer ${send.token}`)
    return prepare().then(() => worker.fetch(new Request(request, { headers }), environment, ctx))
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
    ready: prepare,
    settle: async () => {
      await Promise.all(waited)
    },
  }
}

export type Booted = ReturnType<typeof boot>

export async function wire(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

export async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('the call was expected to fail, and it answered')
}

export function onlyCall(seen: readonly Seen[]): Seen {
  const [call, ...rest] = seen
  if (call === undefined || rest.length > 0) {
    throw new Error(`expected exactly one call of a handler, found ${seen.length}`)
  }
  return call
}
