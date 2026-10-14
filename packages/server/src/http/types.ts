import type { TokenRejection } from '../auth/index.ts'
import type { HollwareEnv } from '../index.ts'

/** What the routes of the gateway read from Hono: the Worker's bindings and the id of the request. */
export type GatewayEnv = {
  Bindings: HollwareEnv
  Variables: {
    /** One `crypto.randomUUID()` per request, set before anything else runs. */
    requestId: string
  }
}

/** A request to `/mcp` that was turned away for its credentials (a 401). */
export interface AuthRefusedLog {
  readonly kind: 'auth_refused'
  readonly requestId: string
  /**
   * Why. The caller is told none of it: every refused token gets the same answer, so that
   * nobody learns which tokens exist. The operator reads it here.
   */
  readonly reason: 'no_token' | TokenRejection
}

/** A request whose route threw. The cause is here, for the operator, and never in the answer. */
export interface RequestErrorLog {
  readonly kind: 'request_error'
  readonly requestId: string
  readonly method: string
  /** The path only: a query string could hold anything. */
  readonly path: string
  readonly detail: string
}

/** Events a write committed that could not be put on the Queue; the cron trigger sweeps them. */
export interface EnqueueFailedLog {
  readonly kind: 'enqueue_failed'
  readonly requestId: string
  readonly message: string
}

/** What the gateway writes to the log, besides the lines of the MCP endpoint. */
export type GatewayLogEntry = AuthRefusedLog | RequestErrorLog | EnqueueFailedLog
