import type { ResolvedAuth, ResolvedSite } from '@hollware/core'
import { Hono, type Context } from 'hono'
import { checkHostAndOrigin, unauthorized } from '../auth/index.ts'
import { connect } from '../db/d1.ts'
import { createD1Store } from '../db/index.ts'
import { enqueue } from '../events/run.ts'
import type { HollwareEnv, HollwareRpc } from '../index.ts'
import type { AuditLogFor, McpEndpoint } from '../mcp/index.ts'
import { actorOf, createAuditLog, systemActor, type AuditActor } from '../audit/log.ts'
import {
  recordRotation,
  refreshTokenOf,
  reusedAnswer,
  spentRefresh,
} from '../oauth/refresh-reuse.ts'
import type { RequestPrincipal } from '../auth/types.ts'
import type { Clock, Structure } from '../ports.ts'
import { newWebhookSecret, seal } from '../structure/seal.ts'
import { createSecretStore, createStructureStore } from '../structure/store.ts'
import { installErrorHandling } from './errors.ts'
import { installAdmin } from './admin.ts'
import { installAdminApi } from './admin-api.ts'
import { installOpsApi } from './ops-api.ts'
import { installReadApi } from './read-api.ts'
import type { Handlers } from '../ops/types.ts'
import { installIdentity } from '../identity/routes.ts'
import { installAuthorize } from '../oauth/authorize.ts'
import { adminClient } from '../oauth/admin.ts'
import { createOAuth, type Proceed, type Refusal, type ResourceName } from '../oauth/server.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'
import { semanticOfEnv } from '../semantic/cloudflare.ts'
import { analyticsReaderOf } from '../analytics/cloudflare.ts'
import { installEvents } from './events.ts'

export interface GatewayOptions {
  /** The sites this deployment serves, by key. A token belongs to one of them, and acts on it. */
  readonly sites: ReadonlyMap<string, ResolvedSite>
  /** Their keys. When `refresh` is given, both stay current with D1. */
  readonly siteKeys?: ReadonlySet<string>
  /** Brings the sites in line with D1 (ADR-033): when stale, or at once with `force`. */
  readonly refresh?: (db: D1Database, options?: { readonly force?: boolean }) => Promise<void>
  /** Built once for the isolate; the gateway mounts it at `/mcp`. */
  readonly mcp: McpEndpoint
  /** The time of a request: the expiry of a token and every write are read from it. */
  readonly clock: Clock
  readonly log: (entry: GatewayLogEntry) => void
  /** The read methods for the HTTP read API at `/v1`; without them there is no `/v1`. */
  readonly read?: (env: HollwareEnv) => HollwareRpc
  /** The OAuth server of the config (ADR-026); dynamic client registration is off without it. */
  readonly auth?: ResolvedAuth
  /** The handlers of the operations, for `POST /v1/ops/{name}`; without them there is no route. */
  readonly handlers?: Handlers
}

/**
 * A 401 of a resource server, with Hollware's body: the same JSON as every other refusal, and the
 * challenge of the resource server, which names its metadata (RFC 9728) and the baseline scope.
 */
function withRefusalBody(response: Response, refused: boolean): Response {
  const ours = unauthorized(refused ? 'unknown' : undefined)
  const headers = new Headers(response.headers)
  headers.set('content-type', 'application/json')
  const challenge = headers.get('www-authenticate')
  if (challenge !== null)
    headers.set('www-authenticate', challenge.replace('realm="OAuth"', 'realm="hollware"'))
  return new Response(ours.body, { status: 401, headers })
}

/** The `fetch` of the Worker. */
export type Gateway = (
  request: Request,
  env: HollwareEnv,
  ctx: ExecutionContext,
) => Promise<Response>

/**
 * The HTTP gateway of the Worker (ADR-019): a Hono 5 app, built once, that runs in this order for
 * every request:
 *
 * 1. an id for the request, which its errors and its log lines carry;
 * 2. the Host and Origin guard (`checkHostAndOrigin`), before any route, health and unknown
 *    paths included. It fails closed: no valid `HOLLWARE_PUBLIC_URL` is a 500;
 * 3. the routes: `GET /health` answers `{ "ok": true }`, and `/mcp` answers every method, after
 *    the token check below. Any other path is a JSON 404.
 *
 * The token check is the 401 that stands in front of the MCP endpoint, which never authenticates:
 * no token, or a token that `checkPersonalToken` refuses, is `unauthorized()` and the endpoint is
 * not called. It looks the token up on the `D1Database` binding and never on a replica session,
 * so a revoked token stops at once. Its reason goes to the log and never to the answer. The write
 * of `last_used_at` is handed to `ctx.waitUntil`: Workers cancel a promise nobody waits for.
 *
 * The endpoint then gets the request as it came, with its body and its `Mcp-*` headers untouched
 * (a 2026 client's headers must agree with its body), and the primary database: an agent reads
 * what it has just written.
 *
 * Whatever a route throws ends in the error middleware (`errors.ts`) as a JSON 500 that leaks
 * nothing. A failed D1 query while the token is checked is one of those: it is never a 401.
 */
export function createGateway(options: GatewayOptions): Gateway {
  const { sites, mcp, clock, log } = options
  const siteKeys: ReadonlySet<string> = options.siteKeys ?? new Set(sites.keys())
  const app = new Hono<GatewayEnv>()
  /**
   * The Worker's own context of each request. Hono hands its routes the same object under a
   * narrower type of its own, and the OAuth library wants the Worker's.
   */
  const contexts = new WeakMap<Request, ExecutionContext>()
  const workerContext = (c: Context<GatewayEnv>): ExecutionContext => {
    const ctx = contexts.get(c.req.raw)
    if (ctx === undefined) throw new Error('A request reached a route without its context')
    return ctx
  }
  const oauth = createOAuth({
    sites: siteKeys,
    clock,
    dynamicClientRegistration: options.auth?.dynamicClientRegistration ?? false,
    log,
  })

  /**
   * What a write hands to the Queue: the events it committed, after the answer (ADR-025). The
   * cron trigger's sweep catches any that this misses.
   */
  const notify =
    (c: Context<GatewayEnv>, requestId: string, site: string) => (ids: readonly string[]) => {
      c.executionCtx.waitUntil(
        enqueue({ queue: c.env.EVENTS, db: connect(c.env.DB), site, ids, clock }).catch(
          (error: unknown) => {
            log({ kind: 'enqueue_failed', requestId, message: String(error) })
          },
        ),
      )
    }

  /** The structure of the sites in D1, and how this isolate sees a change of it at once. */
  const structureOf = (db: D1Database, master?: string): Structure => ({
    store: createStructureStore(db, () => clock.now()),
    changed: async () => {
      await options.refresh?.(db, { force: true })
    },
    secrets: {
      make: async (site, name) => {
        if (master === undefined) return null
        const secret = newWebhookSecret()
        const sealed = await seal(master, secret, { site, name })
        await createSecretStore(db, () => clock.now()).write(site, name, sealed)
        return secret
      },
    },
  })

  /**
   * The activity log of a request (ADR-037), for an actor known once the client has said what it
   * is. A person in the admin is a `user`; any other OAuth client, an `oauth_client`.
   */
  const auditOf =
    (
      c: Context<GatewayEnv>,
      principal: RequestPrincipal,
      adminClientId: string | null,
    ): AuditLogFor =>
    (meta) =>
      auditAs(c, actorOf(principal, meta, adminClientId))

  /**
   * A protected route: the resource server of `resource` answers a request without a token and a
   * token it refuses (401, logged with the reason), and `proceed` gets the principal of the rest.
   */
  const protect = async (
    c: Context<GatewayEnv>,
    resource: ResourceName,
    proceed: Proceed,
  ): Promise<Response> => {
    const requestId = c.get('requestId')
    // A token is checked against the sites, current with D1; a request with none reads nothing.
    if (c.req.header('authorization') !== undefined) await options.refresh?.(c.env.DB)
    /** What the check said besides the answer: why it refused, or what it threw. */
    const outcome: { refusal: Refusal | null; failure: { readonly error: unknown } | null } = {
      refusal: null,
      failure: null,
    }
    const response = await oauth(c.env.HOLLWARE_PUBLIC_URL).protect(
      resource,
      c.req.raw,
      c.env,
      workerContext(c),
      {
        proceed,
        refused: (reason) => {
          outcome.refusal = reason
        },
        defer: (promise) => {
          workerContext(c).waitUntil(promise)
        },
        failed: (error) => {
          outcome.failure = { error }
        },
      },
    )
    // A failure while the token was checked, such as D1's, is no 401: it is the error handler's.
    if (outcome.failure !== null) throw outcome.failure.error
    if (response.status !== 401) return response
    log({ kind: 'auth_refused', requestId, reason: outcome.refusal ?? 'no_token' })
    return withRefusalBody(response, outcome.refusal !== null)
  }

  /** A read of the read API, the one kind of request a page of another origin may make. */
  const isCorsRead = (request: Request): boolean => {
    const { pathname } = new URL(request.url)
    return (
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      pathname.startsWith('/v1/') &&
      // The admin's routes read too; the operations are POST, which the method already refuses.
      !pathname.startsWith('/v1/admin/')
    )
  }

  /** Whether the definition of some site lets pages of `origin` read it. */
  const anyCorsOrigin = (origin: string): boolean =>
    [...sites.values()].some((site) => site.cors.origins.includes(origin))
  /**
   * The guard lets a page of such an origin through to the read API alone, and only to read: the
   * read API then checks the origin against the site of the token.
   */
  const readsFromAnyCorsOrigin = (request: Request, origin: string): boolean => {
    const { pathname } = new URL(request.url)
    // The beacon of a site's pages (ADR-031): the route checks the origin against the site that
    // the beacon names, which is the only check that knows which site that is.
    if (request.method === 'POST' && pathname === '/events') return true
    return anyCorsOrigin(origin) && isCorsRead(request)
  }

  /**
   * A route for a person or their personal token: a read token reads over the read API alone, so
   * it is refused here, before anything runs (403, as a token that lacks a scope).
   */
  const protectWrites = (
    c: Context<GatewayEnv>,
    resource: ResourceName,
    proceed: Proceed,
  ): Promise<Response> =>
    protect(c, resource, async (principal, auth) =>
      principal.kind === 'read'
        ? Response.json(
            {
              code: 'forbidden',
              message: 'A read token reads published content over GET /v1, and nothing else.',
              fix: 'Use a personal token (hw_pat_) or sign in with OAuth for this.',
            },
            { status: 403, headers: { 'cache-control': 'no-store' } },
          )
        : proceed(principal, auth),
    )

  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID())
    await next()
  })

  app.use('*', async (c, next) => {
    // The guard answers a request it refuses without the database, except where it has to read
    // the sites: a page of another origin that reads the read API, or sends the beacon. Those
    // see the sites current with D1 (ADR-033).
    const origin = c.req.header('origin')
    if (
      origin !== undefined &&
      (isCorsRead(c.req.raw) || readsFromAnyCorsOrigin(c.req.raw, origin))
    ) {
      await options.refresh?.(c.env.DB)
    }
    const refusal = checkHostAndOrigin(c.req.raw, c.env.HOLLWARE_PUBLIC_URL, readsFromAnyCorsOrigin)
    if (refusal !== null) return refusal
    await next()
  })

  // The routes anyone may call without a token, limited per address and route when the Worker
  // has a rate limiting binding (T-10): a person or a site never comes near the limit, a script
  // that hammers sign-in, the token endpoint or the beacon does.
  app.use('*', async (c, next) => {
    const limiter = c.env.HOLLWARE_RATE_LIMIT
    const group = limitedRoute(c.req.method, new URL(c.req.url).pathname)
    if (limiter === undefined || group === null) return next()
    const address = c.req.header('cf-connecting-ip') ?? 'unknown'
    const { success } = await limiter.limit({ key: `${group}:${address}` })
    if (success) return next()
    log({ kind: 'rate_limited', requestId: c.get('requestId'), route: group })
    return Response.json(
      {
        code: 'rate_limited',
        message: 'Too many requests from this address to this route.',
        fix: 'Wait a minute and try again.',
      },
      { status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store' } },
    )
  })

  // The routes that read the sites without a token to check first: the consent of OAuth, its
  // token endpoint, and the beacon. A route behind a token reads them in `protect`.
  for (const path of ['/authorize', '/oauth/*', '/events']) {
    app.use(path, async (c, next) => {
      await options.refresh?.(c.env.DB)
      await next()
    })
  }

  app.get('/health', () =>
    Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }),
  )

  app.all('/mcp', async (c) =>
    protectWrites(c, 'mcp', async (principal) => {
      const requestId = c.get('requestId')
      const db = c.env.DB
      const site = sites.get(principal.site)
      // The token check refuses a token of a site this deployment does not serve.
      if (site === undefined) throw new Error(`No site ${principal.site} for a checked token`)
      return await mcp.fetch(c.req.raw, {
        principal,
        requestId,
        resourceMetadataUrl: oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.mcp,
        context: {
          site,
          store: createD1Store(db, { clock }),
          clock,
          notify: notify(c, requestId, site.key),
          semantic: semanticOfEnv(c.env),
          analytics: analyticsReaderOf(c.env),
          structure: structureOf(db, c.env.HOLLWARE_SECRET),
        },
        // A read token never gets here; the admin's client never calls MCP.
        ...(principal.kind === 'read'
          ? {}
          : {
              audit: {
                log: auditOf(c, principal, null),
                defer: (work: Promise<void>) => {
                  c.executionCtx.waitUntil(work)
                },
              },
            }),
      })
    }),
  )

  // The metadata of each resource (RFC 9728) is its resource server's to answer.
  for (const resource of ['mcp', 'v1'] as const) {
    app.all(`/.well-known/oauth-protected-resource/${resource}`, async (c) =>
      oauth(c.env.HOLLWARE_PUBLIC_URL).protect(resource, c.req.raw, c.env, workerContext(c), {
        proceed: () => Promise.resolve(new Response(null, { status: 404 })),
        refused: () => undefined,
        defer: () => undefined,
        failed: () => undefined,
      }),
    )
  }
  // The rest of the authorization server: its metadata (RFC 8414), the token endpoint, which
  // revokes too, and registration when the config turns it on. `/authorize` is ours.
  /** The activity log of a request for an actor the route knows itself (ADR-037). */
  const auditAs = (c: Context<GatewayEnv>, actor: AuditActor) =>
    createAuditLog({
      db: c.env.DB,
      actor,
      requestId: c.get('requestId'),
      address: c.req.header('cf-connecting-ip') ?? null,
      master: c.env.HOLLWARE_SECRET,
      now: () => clock.now(),
      log,
    })
  /** A site as the activity log needs it, current with D1: a route of no token refreshed nothing. */
  const auditSite = async (c: Context<GatewayEnv>, key: string) => {
    await options.refresh?.(c.env.DB)
    return sites.get(key)
  }
  installAuthorize(app, { sites: siteKeys, clock, oauth, site: auditSite, audit: auditAs })
  const authorizationServer = (c: Context<GatewayEnv>) =>
    oauth(c.env.HOLLWARE_PUBLIC_URL).authorizationServer.fetch(c.req.raw, c.env, workerContext(c))
  app.all('/.well-known/oauth-authorization-server', authorizationServer)
  // The token endpoint, with the reuse of a spent refresh token caught before the library sees it:
  // that revokes the grant (T-34, src/oauth/refresh-reuse.ts).
  app.all('/oauth/*', async (c) => {
    const refresh = await refreshTokenOf(c.req.raw)
    if (refresh === null) return authorizationServer(c)
    const now = Math.floor(clock.now().getTime() / 1000)
    const reused = await spentRefresh(c.env.OAUTH_KV, refresh, now)
    if (reused !== null) {
      await oauth(c.env.HOLLWARE_PUBLIC_URL)
        .authorizationServer.getOAuthApi(c.env)
        .revokeGrant(reused.grantId, reused.userId)
      log({ kind: 'refresh_reused', requestId: c.get('requestId'), grantId: reused.grantId })
      const site = reused.site === null ? undefined : await auditSite(c, reused.site)
      if (site !== undefined) {
        await auditAs(c, systemActor(reused.userId)).write(site, {
          action: 'app.refresh_reused',
          outcome: 'denied',
          errorCode: 'invalid_grant',
          target: { type: 'grant', id: reused.grantId },
        })
      }
      return reusedAnswer()
    }
    const response = await authorizationServer(c)
    if (response.ok) await recordRotation(c.env.OAUTH_KV, refresh.grantId, now)
    return response
  })

  installIdentity(app, { clock, site: auditSite, audit: auditAs })
  installAdmin(app, { oauth })

  installAdminApi(app, {
    sites: siteKeys,
    site: (key) => sites.get(key),
    audit: async (c, principal) =>
      auditOf(c, principal, (await adminClient(oauth(c.env.HOLLWARE_PUBLIC_URL), c.env)).clientId),
    clock,
    oauth,
    protect: (c, proceed) => protectWrites(c, 'v1', proceed),
    metadataUrl: (c) => oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.v1,
  })

  if (options.handlers !== undefined) {
    installOpsApi(app, {
      sites,
      handlers: options.handlers,
      clock,
      log,
      protect: (c, proceed) => protectWrites(c, 'v1', proceed),
      metadataUrl: (c) => oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.v1,
      notify,
      structure: structureOf,
      audit: async (c, principal) =>
        auditOf(
          c,
          principal,
          (await adminClient(oauth(c.env.HOLLWARE_PUBLIC_URL), c.env)).clientId,
        ),
    })
  }

  if (options.read !== undefined) {
    installReadApi(app, {
      read: options.read,
      corsOrigins: (site) => sites.get(site)?.cors.origins ?? [],
      anyCorsOrigin,
      protect: (c, proceed) => protect(c, 'v1', proceed),
      metadataUrl: (c) => oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.v1,
    })
  }

  installEvents(app, { sites })

  installErrorHandling(app, log)

  return async (request, env, ctx) => {
    contexts.set(request, ctx)
    return await app.fetch(request, env, ctx)
  }
}

/** The group of a route that is rate limited, or `null` for one that is not (T-10). */
export function limitedRoute(method: string, pathname: string): string | null {
  if (method !== 'POST') return null
  if (pathname.startsWith('/auth/')) return 'auth'
  if (pathname === '/oauth/token' || pathname === '/oauth/register') return 'oauth'
  if (pathname === '/events') return 'beacon'
  return null
}
