import type { Hono } from 'hono'
import { describeError } from '../mcp/errors.ts'
import type { GatewayEnv, GatewayLogEntry } from './types.ts'

export interface GatewayErrorBody {
  readonly code: 'not_found' | 'internal' | 'not_migrated'
  readonly message: string
  readonly fix: string
}

function gatewayError(status: 404 | 500 | 503, body: GatewayErrorBody): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

const MISSING_SCHEMA = /no such (?:table|column)|has no column named/

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
