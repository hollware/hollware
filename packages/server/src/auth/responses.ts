import type { Scope } from '@hollware/core'
import type { TokenRejection } from './token.ts'

/**
 * What the auth layer answers, as JSON in the shape of a `HollwareError` (`code`, `message`,
 * `fix`). These codes are the layer's own: `ERROR_CODES` of `@hollware/core` are the errors of an
 * operation, and a request refused here never reaches one. `insufficient_scope` is the one both
 * share, with the same meaning.
 */
export type AuthErrorCode =
  | 'unauthorized'
  | 'insufficient_scope'
  | 'forbidden_host'
  | 'forbidden_origin'
  | 'misconfigured'

export interface AuthErrorBody {
  readonly code: AuthErrorCode
  readonly message: string
  readonly fix: string
}

/** The challenge of every 401 and 403 (RFC 6750). */
const REALM = 'Bearer realm="hollware"'

/**
 * A JSON error response that no cache keeps. `challenge` is the `WWW-Authenticate` value of a
 * 401 or a 403 that answers a bearer token.
 */
export function authErrorResponse(
  status: 401 | 403 | 500,
  body: AuthErrorBody,
  challenge?: string,
): Response {
  const headers = new Headers({ 'cache-control': 'no-store' })
  if (challenge !== undefined) headers.set('www-authenticate', challenge)
  return Response.json(body, { status, headers })
}

/**
 * 401. Without a `reason` the request presented no token, and the challenge only names the realm
 * (RFC 6750: a request without credentials gets no error code). With one, a token was presented
 * and refused, and the challenge says `invalid_token`. The answer is the same for every reason:
 * a caller that sends tokens at random never learns which of them exist, or ever did. The reason
 * is for the log; the fix says how to get a token that works.
 */
export function unauthorized(reason?: TokenRejection): Response {
  if (reason === undefined) {
    return authErrorResponse(
      401,
      {
        code: 'unauthorized',
        message: 'The request carries no personal token.',
        fix: 'Send a personal token as "Authorization: Bearer <token>". Create one with `hollware token create`.',
      },
      REALM,
    )
  }
  return authErrorResponse(
    401,
    {
      code: 'unauthorized',
      message: 'The personal token was not accepted.',
      fix: 'Tokens expire and can be revoked. Create a new one with `hollware token create` and send it as "Authorization: Bearer <token>".',
    },
    `${REALM}, error="invalid_token"`,
  )
}

/**
 * 403 for a token that authenticated but lacks scopes. It names every scope that is missing, in
 * the body and in the challenge (RFC 6750), so that a client asks for all of them at once.
 */
export function insufficientScope(missing: readonly Scope[]): Response {
  return authErrorResponse(
    403,
    {
      code: 'insufficient_scope',
      message: `The token lacks a scope this operation requires. Missing: ${missing.join(', ')}.`,
      fix: "Send a token that carries every missing scope. Create one with `hollware token create`; a token only gets the scopes its user's role allows.",
    },
    `${REALM}, error="insufficient_scope", scope="${missing.join(' ')}"`,
  )
}
