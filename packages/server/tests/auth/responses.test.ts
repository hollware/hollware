import { describe, expect, it } from 'vite-plus/test'

import { insufficientScope, unauthorized } from '../../src/auth/responses.ts'
import type { TokenRejection } from '../../src/auth/token.ts'

// Fails when: unauthorized (src/auth/responses.ts) stops answering 401 with the realm challenge,
// adds `invalid_token` when no token was presented or leaves it out when one was refused, or lets
// the body say which of unknown, expired and revoked it was; insufficientScope stops answering
// 403, names fewer scopes than are missing in the challenge or in the body, or changes their
// order; authErrorResponse stops sending JSON with `Cache-Control: no-store`.

async function wire(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.json(),
  }
}

const REFUSED = {
  status: 401,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'www-authenticate': 'Bearer realm="hollware", error="invalid_token"',
  },
  body: {
    code: 'unauthorized',
    message: 'The personal token was not accepted.',
    fix: 'Tokens expire and can be revoked. Create a new one with `hollware token create` and send it as "Authorization: Bearer <token>".',
  },
}

describe('unauthorized', () => {
  it('answers a request without a token with the realm alone', async () => {
    expect(await wire(unauthorized())).toEqual({
      status: 401,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="hollware"',
      },
      body: {
        code: 'unauthorized',
        message: 'The request carries no personal token.',
        fix: 'Send a personal token as "Authorization: Bearer <token>". Create one with `hollware token create`.',
      },
    })
  })

  it.each<TokenRejection>(['unknown', 'expired', 'revoked'])(
    'answers a token that was refused as %s with invalid_token, and says no more than for the others',
    async (reason) => {
      expect(await wire(unauthorized(reason))).toEqual(REFUSED)
    },
  )
})

describe('insufficientScope', () => {
  it('names the scope that is missing in the challenge and in the body', async () => {
    expect(await wire(insufficientScope(['content:write']))).toEqual({
      status: 403,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'www-authenticate':
          'Bearer realm="hollware", error="insufficient_scope", scope="content:write"',
      },
      body: {
        code: 'insufficient_scope',
        message: 'The token lacks a scope this operation requires. Missing: content:write.',
        fix: "Send a token that carries every missing scope. Create one with `hollware token create`; a token only gets the scopes its user's role allows.",
      },
    })
  })

  it('names every missing scope, in the order given', async () => {
    expect(
      await wire(insufficientScope(['schema:admin', 'content:write', 'content:publish'])),
    ).toEqual({
      status: 403,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
        'www-authenticate':
          'Bearer realm="hollware", error="insufficient_scope", scope="schema:admin content:write content:publish"',
      },
      body: {
        code: 'insufficient_scope',
        message:
          'The token lacks a scope this operation requires. Missing: schema:admin, content:write, content:publish.',
        fix: "Send a token that carries every missing scope. Create one with `hollware token create`; a token only gets the scopes its user's role allows.",
      },
    })
  })
})
