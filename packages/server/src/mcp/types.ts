import type { AuditLog } from '../audit/log.ts'
import type { ErrorCode } from '@hollware/core'
import type { Implementation } from '@modelcontextprotocol/server'
import type { Principal } from '../auth/types.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'

/**
 * What the gateway knows about one request to `/mcp`, once it has checked the Host, the Origin
 * and the token. The endpoint never authenticates: it serves the request as the principal it is
 * given, and refuses to serve one without a principal.
 */
export interface McpCall {
  /** Who calls: the scopes of the principal decide which tools it may use. */
  readonly principal: Principal
  /** An id for this request, which the log lines of the call carry. */
  readonly requestId: string
  /**
   * The protected resource metadata of `/mcp` (RFC 9728), which a 403 of a scope challenge names
   * so that the client knows where to ask for more; `null` when there is none, as in the tests of
   * the endpoint alone.
   */
  readonly resourceMetadataUrl?: string | null
  /**
   * The site, the store and the clock the handlers work with. The view is not here: over MCP an
   * operation always reads the head, so the adapter sets it and the gateway cannot get it wrong.
   * The client is not here either: it is whatever the MCP client says about itself.
   */
  readonly context: Omit<OperationContext, 'principal' | 'requestId' | 'client' | 'view'>
  /**
   * The activity log of the request (ADR-037): every call of a tool that is not a read writes a
   * line, refused ones too. `defer` keeps the Worker alive for a line written after the answer.
   * Absent in the tests of the endpoint alone.
   */
  readonly audit?: {
    readonly log: AuditLogFor
    readonly defer: (work: Promise<void>) => void
  }
}

/** The log of a request whose actor is known once the client has said what it is. */
export type AuditLogFor = (meta: Readonly<Record<string, unknown>> | null) => AuditLog

/** One line per call of a tool: what happened, never what was asked. */
export interface McpCallLog {
  readonly kind: 'call'
  readonly requestId: string
  /** The tool, which is the operation. */
  readonly tool: string
  /**
   * The outcome of the operation, or `null` when it did not answer. An answer that was then
   * replaced by an error, such as one over the output cap, keeps its outcome here: the write it
   * reports happened.
   */
  readonly outcome: string | null
  /** The code of the error that the caller got, or `null` when the call did not end in one. */
  readonly errorCode: ErrorCode | null
  /** Whether the caller got a result with `isError`. */
  readonly isError: boolean
  readonly durationMs: number
  /** What the caller never sees: the cause of an error, for the operator. */
  readonly detail: string | null
}

/**
 * Something the MCP SDK reports on its own: a request it refused (a wrong content type, headers
 * that disagree with the body, an unsupported version) or a failure while serving.
 */
export interface McpProtocolErrorLog {
  readonly kind: 'protocol_error'
  readonly message: string
}

export type McpLogEntry = McpCallLog | McpProtocolErrorLog

export interface McpEndpointOptions {
  /** One handler for every operation. */
  readonly handlers: Handlers
  /** What the server calls itself in `server/discover` and `initialize`. */
  readonly serverInfo: Implementation
  /** Gets one line per call. The default is to log nothing; a throwing logger never fails a call. */
  readonly log?: (entry: McpLogEntry) => void
  /** How long an operation may take; `OPERATION_TIMEOUT_MS` by default. Tests shorten it. */
  readonly timeoutMs?: number
}

/** The MCP endpoint, for the gateway to mount at `/mcp`. */
export interface McpEndpoint {
  /**
   * Serves one request, in either protocol era. It answers 403 with a scope challenge to a
   * principal that lacks a scope of the tool it calls, and it rejects when `call` has no
   * principal: that is a bug of the gateway, which answers 401 before it gets here.
   */
  fetch(request: Request, call: McpCall): Promise<Response>
}
