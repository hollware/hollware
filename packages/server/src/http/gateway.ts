import type { ResolvedAuth, ResolvedSite } from '@hollware/core'
import { Hono, type Context } from 'hono'
import { checkHostAndOrigin, unauthorized } from '../auth/index.ts'
import { connect } from '../db/d1.ts'
import { createD1Store } from '../db/index.ts'
import { enqueue } from '../events/run.ts'
import type { HollwareEnv, HollwareRpc } from '../index.ts'
import type { McpEndpoint } from '../mcp/index.ts'
import type { Clock } from '../ports.ts'
import { installErrorHandling } from './errors.ts'
import { installReadApi } from './read-api.ts'
import { installIdentity } from '../identity/routes.ts'
import { installAuthorize } from '../oauth/authorize.ts'
import { createOAuth, type Proceed, type Refusal, type ResourceName } from '../oauth/server.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

export interface GatewayOptions {
  /** The one site this deployment serves (v0.1). Its key is the site a token must belong to. */
  readonly site: ResolvedSite
  /** Built once for the isolate; the gateway mounts it at `/mcp`. */
  readonly mcp: McpEndpoint
  /** The time of a request: the expiry of a token and every write are read from it. */
  readonly clock: Clock
  readonly log: (entry: GatewayLogEntry) => void
  /** The read methods for the HTTP read API at `/v1`; without them there is no `/v1`. */
  readonly read?: (env: HollwareEnv) => HollwareRpc
  /** The OAuth server of the config (ADR-026); dynamic client registration is off without it. */
  readonly auth?: ResolvedAuth
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
  const { site, mcp, clock, log } = options
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
    site: site.key,
    clock,
    dynamicClientRegistration: options.auth?.dynamicClientRegistration ?? false,
    log,
  })

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

  app.use('*', async (c, next) => {
    c.set('requestId', crypto.randomUUID())
    await next()
  })

  app.use('*', async (c, next) => {
    const refusal = checkHostAndOrigin(c.req.raw, c.env.HOLLWARE_PUBLIC_URL)
    if (refusal !== null) return refusal
    await next()
  })

  app.get('/health', () =>
    Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } }),
  )

  app.all('/mcp', async (c) =>
    protect(c, 'mcp', async (principal) => {
      const requestId = c.get('requestId')
      const db = c.env.DB
      return await mcp.fetch(c.req.raw, {
        principal,
        requestId,
        resourceMetadataUrl: oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.mcp,
        context: {
          site,
          store: createD1Store(db, { clock }),
          clock,
          // The events a write committed go to the Queue after the answer (ADR-025); the cron
          // trigger's sweep catches any that this misses.
          notify: (ids) => {
            c.executionCtx.waitUntil(
              enqueue({ queue: c.env.EVENTS, db: connect(db), site: site.key, ids, clock }).catch(
                (error: unknown) => {
                  log({ kind: 'enqueue_failed', requestId, message: String(error) })
                },
              ),
            )
          },
        },
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
  installAuthorize(app, { site: site.key, clock, oauth })
  const authorizationServer = (c: Context<GatewayEnv>) =>
    oauth(c.env.HOLLWARE_PUBLIC_URL).authorizationServer.fetch(c.req.raw, c.env, workerContext(c))
  app.all('/.well-known/oauth-authorization-server', authorizationServer)
  app.all('/oauth/*', authorizationServer)

  installIdentity(app, { site: site.key, clock })

  if (options.read !== undefined) {
    installReadApi(app, {
      read: options.read,
      site: site.key,
      protect: (c, proceed) => protect(c, 'v1', proceed),
      metadataUrl: (c) => oauth(c.env.HOLLWARE_PUBLIC_URL).metadataUrls.v1,
    })
  }

  installErrorHandling(app, log)

  return async (request, env, ctx) => {
    contexts.set(request, ctx)
    return await app.fetch(request, env, ctx)
  }
}
