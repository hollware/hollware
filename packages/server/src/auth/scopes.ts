import type { Scope } from '@hollware/core'
import type { Principal } from './types.ts'

/**
 * The scopes an operation requires that the principal lacks, in the order the operation lists
 * them. Empty means the principal may call it; otherwise the answer is `insufficientScope` with
 * all of them, so that a client asks for everything it needs in one go.
 */
export function missingScopes(
  principal: Pick<Principal, 'scopes'>,
  required: readonly Scope[],
): Scope[] {
  const granted: readonly Scope[] = principal.scopes
  return required.filter((scope) => !granted.includes(scope))
}
