import type { Actor } from '../ports.ts'
import { internalError } from './errors.ts'
import type { OperationContext } from './types.ts'

/**
 * Who a write is made by: the token of the call, with what its client said about itself. Only a
 * personal token writes (ADR-019). The adapters check the scopes of the operation before any
 * handler runs and never route a write for another principal, so reaching one with a principal
 * that is not a token is a bug, answered as `internal` before anything is read or written.
 */
export function actorOf(context: OperationContext): Actor {
  const { principal } = context
  if (principal.kind !== 'token') {
    throw internalError(
      context,
      `A write was routed for a principal of kind ${principal.kind}; only a token writes.`,
    )
  }
  return {
    kind: 'token',
    userId: principal.userId,
    tokenId: principal.tokenId,
    meta: context.client,
  }
}
