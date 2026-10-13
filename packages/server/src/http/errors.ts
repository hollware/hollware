import type { Hono } from 'hono'
import { describeError } from '../mcp/errors.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

/**
 * The answers the gateway makes for itself, as JSON in the shape of a `HollwareError` (`code`,
 * `message`, `fix`), like the answers of the auth layer. The two codes are the gateway's own.
 */
export interface GatewayErrorBody {
  readonly code: 'not_found' | 'internal'
  readonly message: string
  readonly fix: string
}

/** A JSON error response that no cache keeps. */
function gatewayError(status: 404 | 500, body: GatewayErrorBody): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Everything that differs between Hono 4 and Hono 5 error handling lives in this file (spike S1).
 *
 * Hono 4: `app.onError((error, c) => Response)`, one handler for the app.
 * Hono 5: `app.onError((c, next) => Response)` registers error middleware, and the error is
 * `c.error`. A Hono 4 handler registered on Hono 5 is not rejected: it is called with the context
 * where it expects the error, throws, and the app answers a plain-text 500. So the tests read the
 * JSON body of both answers.
 *
 * - An error that a route throws is a JSON 500 with a fixed message, and the id of the request
 *   in its fix, which is how the operator finds the line of the log that has the cause. The cause
 *   goes to the log and never to the caller, whose agent could repeat it to a person or to another
 *   system. This holds for every error, a failed D1 query included: nothing turns one into a 401.
 * - A path that no route has is a JSON 404.
 */
export function installErrorHandling(
  app: Hono<GatewayEnv>,
  log: (entry: GatewayLogEntry) => void,
): void {
  app.onError((c) => {
    const requestId = c.get('requestId')
    log({
      kind: 'request_error',
      requestId,
      method: c.req.method,
      path: c.req.path,
      detail: describeError(c.error),
    })
    return gatewayError(500, {
      code: 'internal',
      message: 'The request failed on the server.',
      fix: `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
    })
  })
  app.notFound(() =>
    gatewayError(404, {
      code: 'not_found',
      message: 'This Hollware has no route for that path.',
      fix: 'Send MCP requests to /mcp with "Authorization: Bearer <token>". GET /health tells whether the Worker is up.',
    }),
  )
}
