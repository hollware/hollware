import type { Actor } from '../ports.ts'
import { internalError } from './errors.ts'
import type { OperationContext } from './types.ts'

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
