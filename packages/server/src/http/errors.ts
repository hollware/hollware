import type { Hono } from 'hono'
import { describeError } from '../mcp/errors.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

/**
 * The answers the gateway makes for itself, as JSON in the shape of a `HollwareError` (`code`,
 * `message`, `fix`), like the answers of the auth layer. The two codes are the gateway's own.
 */
export interface GatewayErrorBody {
  readonly code: 'not_found' | 'internal' | 'not_migrated'
  readonly message: string
  readonly fix: string
}

/** A JSON error response that no cache keeps. */
function gatewayError(status: 404 | 500 | 503, body: GatewayErrorBody): Response {
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
 * - But a database that lacks the migrations of the release is a 503 `not_migrated` that says what
 *   to run: an agent that set the project up can fix it, and the cause still goes to the log only.
 * - A path that no route has is a JSON 404.
 */
/** What D1 says when a table or a column of this release is not there: a migration is missing. */
const MISSING_SCHEMA = /no such (?:table|column)|has no column named/

/**
 * Whether an error, or one of its causes, is D1 telling that the database lacks the schema of this
 * release: the one failure whose fix the caller can be told without anything of its cause.
 */
export function isMissingMigration(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (MISSING_SCHEMA.test(current.message)) return true
    current = current.cause
  }
  return false
}

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
    // A database a release ahead of its migrations is no error of the request: say what to run.
    if (isMissingMigration(c.error)) {
      return gatewayError(503, {
        code: 'not_migrated',
        message: 'The database of this Hollware lacks the migrations of its release.',
        fix: 'Apply them: "hollware migrate --local" in local development, "hollware migrate --remote" (or "hollware deploy") for a deployment. Then try again.',
      })
    }
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
