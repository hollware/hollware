import { PREVIEW_QUERY_PARAM } from '@hollware/core'

/**
 * What a site does with a preview link (T-103 of docs/security/threat-model.md): the token travels
 * in a URL once, and in a cookie after that, so it does not stay in the address bar, the history,
 * a `Referer` or a copied link. These are the pure parts, shared by `@hollware/nuxt` and
 * `@hollware/astro`: the integrations only wire them to their framework's requests.
 */

/** The cookie that holds the token of a preview, on the site's own origin. */
export const PREVIEW_COOKIE = 'hollware_preview'

/** How long the cookie lives, in seconds: the hour of the token. */
export const PREVIEW_COOKIE_MAX_AGE = 3600

/** The shape of a token, `hw_prv_<base64url>.<base64url>`. The site cannot check more: Hollware does. */
const TOKEN_SHAPE = /^hw_prv_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** Whether a value is shaped like a preview token. A value that is not is never kept. */
export function isPreviewToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value)
}

/**
 * The preview token of a `Cookie` request header, or `undefined`: none, or one that is not shaped
 * like a token.
 */
export function previewTokenFromCookie(header: string | null | undefined): string | undefined {
  if (header === null || header === undefined) return undefined
  for (const part of header.split(';')) {
    const at = part.indexOf('=')
    if (at === -1 || part.slice(0, at).trim() !== PREVIEW_COOKIE) continue
    const value = part.slice(at + 1).trim()
    return isPreviewToken(value) ? value : undefined
  }
  return undefined
}

/** What to answer a request that carries `?hollware-preview=`. */
export interface PreviewExchange {
  /** The path and query of the same URL without the parameter, other parameters kept in order. */
  readonly location: string
  /** The token, when it is shaped like one; `undefined` when it is not, and no cookie is set. */
  readonly token: string | undefined
}

/**
 * The exchange of a URL that carries `?hollware-preview=<token>`: where to redirect (`303`) and
 * the token to keep in a cookie, or `undefined` when the URL has no such parameter. The token is
 * not checked here: only Hollware can, when the page reads.
 */
export function exchangePreviewLink(
  url: URL | string,
  makeNonce: () => string = nonce,
): PreviewExchange | undefined {
  const { pathname, search } = typeof url === 'string' ? new URL(url) : url
  const kept: string[] = []
  let found: string | undefined
  let seen = false
  for (const pair of search.slice(1).split('&')) {
    if (pair === '') continue
    const at = pair.indexOf('=')
    const key = at === -1 ? pair : pair.slice(0, at)
    if (safeDecode(key) !== PREVIEW_QUERY_PARAM) {
      kept.push(pair)
      continue
    }
    if (seen) continue
    seen = true
    found = at === -1 ? '' : safeDecode(pair.slice(at + 1))
  }
  if (!seen) return undefined
  // A parameter of no secret, new each time, so that the URL the page is read at is in no cache:
  // a cache in front of the site (Workers Cache) would otherwise answer the published page there
  // before the site sees the cookie.
  if (isPreviewToken(found)) kept.push(`${PREVIEW_VIEW_PARAM}=${makeNonce()}`)
  return {
    location: kept.length === 0 ? pathname : `${pathname}?${kept.join('&')}`,
    token: isPreviewToken(found) ? found : undefined,
  }
}

/** The parameter that keeps a previewed page out of every cache: a random value, no secret. */
export const PREVIEW_VIEW_PARAM = 'hollware-view'

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replaceAll('+', ' '))
  } catch {
    return text
  }
}

/**
 * Whether the cookie is `Secure` on a request for this URL: always, but on `http://localhost` and
 * `http://127.0.0.1`, so local development works over plain HTTP.
 */
export function isSecureRequest(url: URL | string): boolean {
  const { protocol, hostname } = typeof url === 'string' ? new URL(url) : url
  return !(protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1'))
}

/** The `Set-Cookie` that keeps a token for its hour: no script reads it, and only this site gets it. */
export function previewCookie(token: string, options: { readonly secure: boolean }): string {
  return cookieLine(token, PREVIEW_COOKIE_MAX_AGE, options.secure)
}

/** The `Set-Cookie` that removes the cookie. */
export function clearedPreviewCookie(options: { readonly secure: boolean }): string {
  return cookieLine('', 0, options.secure)
}

function cookieLine(value: string, maxAge: number, secure: boolean): string {
  return `${PREVIEW_COOKIE}=${value}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAge}`
}

/** The headers of the redirect that exchanges a preview link: no cache, and no `Referer` to follow. */
export function exchangeHeaders(
  exchange: PreviewExchange,
  url: URL | string,
): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ['location', exchange.location],
    ['cache-control', 'no-store'],
    ['referrer-policy', 'no-referrer'],
  ]
  if (exchange.token !== undefined) {
    headers.push(['set-cookie', previewCookie(exchange.token, { secure: isSecureRequest(url) })])
  }
  return headers
}

/**
 * Whether an error is Hollware's refusal of a token as expired or invalid, its code
 * `invalid_preview` (over the binding, or over HTTP as a `HollwareClientError`), looking through
 * `cause`. A token for another entry is no refusal: Hollware answers it as no entry, and it must
 * stay so.
 */
export function isPreviewRefusal(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    if (Reflect.get(current, 'code') === 'invalid_preview') return true
    current = Reflect.get(current, 'cause')
  }
  return false
}
