import type { ResolvedSite } from '@hollware/core'
import { Hono } from 'hono'
import {
  checkHostAndOrigin,
  checkPersonalToken,
  readBearerToken,
  unauthorized,
} from '../auth/index.ts'
import { connect } from '../db/d1.ts'
import { createD1Store } from '../db/index.ts'
import { enqueue } from '../events/run.ts'
import type { HollwareEnv } from '../index.ts'
import type { McpEndpoint } from '../mcp/index.ts'
import type { Clock } from '../ports.ts'
import { installErrorHandling } from './errors.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

export interface GatewayOptions {
  /** The one site this deployment serves (v0.1). Its key is the site a token must belong to. */
  readonly site: ResolvedSite
  /** Built once for the isolate; the gateway mounts it at `/mcp`. */
  readonly mcp: McpEndpoint
  /** The time of a request: the expiry of a token and every write are read from it. */
  readonly clock: Clock
  readonly log: (entry: GatewayLogEntry) => void
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

  app.all('/mcp', async (c) => {
    const requestId = c.get('requestId')
    const token = readBearerToken(c.req.raw)
    if (token === null) {
      log({ kind: 'auth_refused', requestId, reason: 'no_token' })
      return unauthorized()
    }
    const check = await checkPersonalToken(c.env.DB, token, { site: site.key, now: clock.now() })
    if (!check.ok) {
      log({ kind: 'auth_refused', requestId, reason: check.reason })
      return unauthorized(check.reason)
    }
    if (check.touch !== null) c.executionCtx.waitUntil(check.touch)
    const db = c.env.DB
    return await mcp.fetch(c.req.raw, {
      principal: check.principal,
      requestId,
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
  })

  installErrorHandling(app, log)

  return async (request, env, ctx) => await app.fetch(request, env, ctx)
}
