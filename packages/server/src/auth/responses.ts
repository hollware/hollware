import type { Scope } from '@hollware/core'
import type { TokenRejection } from './token.ts'

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

const REALM = 'Bearer realm="hollware"'

export function authErrorResponse(
  status: 401 | 403 | 500,
  body: AuthErrorBody,
  challenge?: string,
): Response {
  const headers = new Headers({ 'cache-control': 'no-store' })
  if (challenge !== undefined) headers.set('www-authenticate', challenge)
  return Response.json(body, { status, headers })
}

export function unauthorized(reason?: TokenRejection): Response {
  if (reason === undefined) {
    return authErrorResponse(
      401,
      {
        code: 'unauthorized',
        message: 'The request carries no token.',
        fix: 'Send a personal token as "Authorization: Bearer <token>" (create one with `hollware token create`), or sign in through OAuth: the challenge names where.',
      },
      REALM,
    )
  }
  return authErrorResponse(
    401,
    {
      code: 'unauthorized',
      message: 'The token was not accepted.',
      fix: 'Tokens expire and can be revoked. Create a new personal token with `hollware token create`, or sign in through OAuth again, and send it as "Authorization: Bearer <token>".',
    },
    `${REALM}, error="invalid_token"`,
  )
}

export function insufficientScope(
  missing: readonly Scope[],
  resourceMetadataUrl?: string,
): Response {
  const metadata =
    resourceMetadataUrl === undefined ? '' : `, resource_metadata="${resourceMetadataUrl}"`
  return authErrorResponse(
    403,
    {
      code: 'insufficient_scope',
      message: `The token lacks a scope this operation requires. Missing: ${missing.join(', ')}.`,
      fix: "Send a token that carries every missing scope: create one with `hollware token create`, or authorize the client again for them. A token only gets the scopes its user's role allows.",
    },
    `${REALM}${metadata}, error="insufficient_scope", scope="${missing.join(' ')}"`,
  )
}
