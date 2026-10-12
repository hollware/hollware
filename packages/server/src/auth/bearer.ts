/**
 * `Bearer`, one or more spaces, then one token with no whitespace in it, and nothing else. The
 * scheme is case-insensitive (RFC 7235); the runtime has already trimmed the whole value.
 */
const BEARER = /^bearer +(\S+)$/i

/**
 * The token of an `Authorization: Bearer <token>` header, as sent, or `null` when the request
 * presents none: no header, another scheme, no token, or more than one (two headers arrive joined
 * with a comma, so they read as two tokens). It never looks at the URL: a token in a query string
 * ends up in logs, referrers and history, so Hollware does not accept one.
 *
 * It does not judge the token. A string that is not a personal token is a token that was
 * presented and refused, which `checkPersonalToken` says and `unauthorized` answers differently
 * from a request without credentials.
 */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  return BEARER.exec(header)?.[1] ?? null
}
