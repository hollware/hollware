import {
  clearedPreviewCookie,
  exchangeHeaders,
  exchangePreviewLink,
  isPreviewRefusal,
  isSecureRequest,
  previewTokenFromCookie,
} from './preview.ts'

/**
 * The answer to the link of a preview: a `303` to the same URL without the parameter, with the
 * token in the `hollware_preview` cookie (an hour, `HttpOnly`, `SameSite=Lax`, `Secure` but on
 * `http://localhost`), `no-store` and `Referrer-Policy: no-referrer`. `null` when the request is
 * not a `GET` or `HEAD` with that parameter. The token is not checked: Hollware does, when the
 * page reads. A value not shaped like a token sets no cookie.
 */
export function previewRedirect(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const url = new URL(request.url)
  const exchange = exchangePreviewLink(url)
  if (exchange === undefined) return null
  return new Response(null, { status: 303, headers: exchangeHeaders(exchange, url) })
}

/**
 * The `Set-Cookie` that removes the preview cookie when `error` says Hollware refused the token
 * as expired or not valid, and `null` for any other error. A token for another entry is no
 * refusal: Hollware answers it as no entry, and the cookie stays.
 */
export function previewCookieClear(error: unknown, request: Request): string | null {
  if (!isPreviewRefusal(error)) return null
  return clearedPreviewCookie({ secure: isSecureRequest(request.url) })
}

/** Whether the request carries a preview token in its cookie. */
export function isPreviewRequest(request: Request): boolean {
  return previewTokenFromCookie(request.headers.get('cookie')) !== undefined
}

/**
 * The headers a page of a visitor who previews must carry: `Cache-Control: no-store` for any
 * request that holds a token, whatever Hollware answered, and the `Set-Cookie` that clears it
 * when `error` is a refusal. Without a token it is empty, so a published page is cached as
 * usual. Merge it into the headers of the response (a `Headers` is what `data()`, `Response`
 * and `NextResponse` take).
 */
export function previewHeaders(request: Request, error?: unknown): Headers {
  const headers = new Headers()
  if (!isPreviewRequest(request)) return headers
  headers.set('cache-control', 'no-store')
  const clear = previewCookieClear(error, request)
  if (clear !== null) headers.append('set-cookie', clear)
  return headers
}
