/**
 * What the gateway composes to authenticate a request (ADR-019): the Host and Origin guard, the
 * bearer token, the token check, the scope check and the answers to a request that fails any of
 * them. `types.ts` holds the `Principal` that the check produces.
 */
export { readBearerToken } from './bearer.ts'
export { checkHostAndOrigin } from './guard.ts'
export {
  insufficientScope,
  unauthorized,
  type AuthErrorBody,
  type AuthErrorCode,
} from './responses.ts'
export { effectiveScopes, isRole, ROLE_SCOPES, ROLES, type Role } from './roles.ts'
export { missingScopes } from './scopes.ts'
export {
  checkPersonalToken,
  type TokenCheck,
  type TokenCheckOptions,
  type TokenPrincipal,
  type TokenRejection,
} from './token.ts'
