import type { Actor } from '../ports.ts'
import { internalError } from './errors.ts'
import type { OperationContext } from './types.ts'

/**
 * Who a write is made by: the person behind the token of the call, with what its client said
 * about itself. A personal token writes as itself (ADR-019); an OAuth access token writes as the
 * client the person allowed, whose id goes with what the client said (ADR-026). The adapters check
 * the scopes of the operation before any handler runs and never route a write for the RPC
 * binding, so reaching one with it is a bug, answered as `internal` before anything is read or
 * written.
 */
export function actorOf(context: OperationContext): Actor {
  const { principal } = context
  if (principal.kind === 'token') {
    return {
      kind: 'token',
      userId: principal.userId,
      tokenId: principal.tokenId,
      meta: context.client,
    }
  }
  if (principal.kind === 'oauth') {
    return {
      kind: 'oauth_client',
      userId: principal.userId,
      tokenId: null,
      meta: { ...context.client, oauthClient: principal.clientId },
    }
  }
  throw internalError(
    context,
    `A write was routed for a principal of kind ${principal.kind}; only a person writes.`,
  )
}
