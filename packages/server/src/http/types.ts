import type { AuditLogEntry } from '../audit/log.ts'
import type { HollwareEnv } from '../index.ts'
import type { Refusal } from '../oauth/server.ts'

/** What the routes of the gateway read from Hono: the Worker's bindings and the id of the request. */
export type GatewayEnv = {
  Bindings: HollwareEnv
  Variables: {
    /** One `crypto.randomUUID()` per request, set before anything else runs. */
    requestId: string
    /** The site of the principal, set once its token is checked (read API). */
    site: string
  }
}

/** A request to `/mcp` or `/v1` that was turned away for its credentials (a 401). */
export interface AuthRefusedLog {
  readonly kind: 'auth_refused'
  readonly requestId: string
  /**
   * Why. The caller is told none of it: every refused token gets the same answer, so that
   * nobody learns which tokens exist. The operator reads it here.
   */
  readonly reason: 'no_token' | Refusal
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

/** An error the OAuth server answered, with the check that failed (never on the wire). */
export interface OAuthErrorLog {
  readonly kind: 'oauth_error'
  readonly code: string
  readonly reason: string | null
}

/** What the gateway writes to the log, besides the lines of the MCP endpoint. */
/** A request a route without a token refused past the rate limit (T-10). */
export interface RateLimitedLog {
  readonly kind: 'rate_limited'
  readonly requestId: string
  readonly route: string
}

export type GatewayLogEntry =
  | AuthRefusedLog
  | RequestErrorLog
  | EnqueueFailedLog
  | OAuthErrorLog
  | RateLimitedLog
  | RefreshReusedLog
  | AuditLogEntry

/** A spent refresh token came back, past the grace of a retry, and its grant was revoked (T-34). */
export interface RefreshReusedLog {
  readonly kind: 'refresh_reused'
  readonly requestId: string
  readonly grantId: string
}
