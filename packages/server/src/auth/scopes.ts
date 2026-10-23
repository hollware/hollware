import type { Scope } from '@hollware/core'
import type { Principal } from './types.ts'

export function missingScopes(
  principal: Pick<Principal, 'scopes'>,
  required: readonly Scope[],
): Scope[] {
  const granted: readonly Scope[] = principal.scopes
  return required.filter((scope) => !granted.includes(scope))
}
