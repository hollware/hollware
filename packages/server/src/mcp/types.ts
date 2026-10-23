import type { AuditLog } from '../audit/log.ts'
import type { ErrorCode } from '@hollware/core'
import type { Implementation } from '@modelcontextprotocol/server'
import type { Principal } from '../auth/types.ts'
import type { Handlers, OperationContext } from '../ops/types.ts'

export interface McpCall {
  readonly principal: Principal
  readonly requestId: string
  readonly resourceMetadataUrl?: string | null
  readonly context: Omit<OperationContext, 'principal' | 'requestId' | 'client' | 'view'>
  readonly audit?: {
    readonly log: AuditLogFor
    readonly defer: (work: Promise<void>) => void
  }
}

export type AuditLogFor = (meta: Readonly<Record<string, unknown>> | null) => AuditLog

export interface McpCallLog {
  readonly kind: 'call'
  readonly requestId: string
  readonly tool: string
  readonly outcome: string | null
  readonly errorCode: ErrorCode | null
  readonly isError: boolean
  readonly durationMs: number
  readonly detail: string | null
}

export interface McpProtocolErrorLog {
  readonly kind: 'protocol_error'
  readonly message: string
}

export type McpLogEntry = McpCallLog | McpProtocolErrorLog

export interface McpEndpointOptions {
  readonly handlers: Handlers
  readonly serverInfo: Implementation
  readonly log?: (entry: McpLogEntry) => void
  readonly timeoutMs?: number
  readonly openWorldTimeoutMs?: number
}

export interface McpEndpoint {
  fetch(request: Request, call: McpCall): Promise<Response>
}
