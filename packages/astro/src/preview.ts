import {
  clearedPreviewCookie,
  exchangeHeaders,
  exchangePreviewLink,
  isPreviewRefusal,
  isSecureRequest,
  previewTokenFromCookie,
} from '@hollware/client'
import type { MiddlewareHandler } from 'astro'

/**
 * What `hollwarePreview()` puts on `Astro.locals`. Declare it in the site's `src/env.d.ts`:
 *
 * ```ts
 * import type { HollwarePreviewLocals } from '@hollware/astro'
 * declare global {
 *   namespace App {
 *     interface Locals extends HollwarePreviewLocals {}
 *   }
 * }
 * ```
 */
export interface HollwarePreviewLocals {
  /** The preview token of the visitor's cookie: pass it to `getLiveEntry('blog', { id, preview })`. */
  hollwarePreview: string | undefined
  /** Set by `refusePreview`: the response clears the cookie. */
  hollwarePreviewRefused: boolean
}

/**
 * The middleware of previews (T-103), for `src/middleware.ts`: `export const onRequest =
 * hollwarePreview()`, or `sequence(hollwarePreview(), ...)`.
 *
 * - A GET with `?hollware-preview=<token>` (the link of the admin's "Preview on the site") is
 *   answered `303` to the same URL without the parameter, with the token in the `hollware_preview`
 *   cookie (HttpOnly, SameSite=Lax, an hour, Secure but on http://localhost and
 *   http://127.0.0.1), `no-store` and `Referrer-Policy: no-referrer`. The token is not checked:
 *   Hollware does, when the page reads. A value not shaped like a token sets no cookie.
 * - Any later request puts the cookie's token on `Astro.locals.hollwarePreview`, and its response
 *   is `no-store`.
 * - A page that gets a refusal from Hollware calls `refusePreview(Astro.locals, error)`: when
 *   the token expired or is not valid, the response clears the cookie. A token for another entry
 *   is answered as no entry and is no refusal.
 */
export function hollwarePreview(): MiddlewareHandler {
  return async (context, next) => {
    const { request, url, locals } = context
    if (request.method === 'GET' || request.method === 'HEAD') {
      const exchange = exchangePreviewLink(url)
      if (exchange !== undefined) {
        return new Response(null, { status: 303, headers: exchangeHeaders(exchange, url) })
      }
    }
    const token = previewTokenFromCookie(request.headers.get('cookie'))
    const slot: HollwarePreviewLocals = Object.assign(locals, {
      hollwarePreview: token,
      hollwarePreviewRefused: false,
    })
    const response = await next()
    if (token === undefined) return response
    // The headers of a response a page got from somewhere else may be immutable: copy them.
    const answer = new Response(response.body, response)
    answer.headers.set('cache-control', 'no-store')
    if (slot.hollwarePreviewRefused) {
      answer.headers.append('set-cookie', clearedPreviewCookie({ secure: isSecureRequest(url) }))
    }
    return answer
  }
}

/**
 * Tells the middleware that Hollware refused the page's token, when `error` (the `error` of
 * `getLiveEntry`) says it expired or is not valid, so the response clears the cookie.
 */
export function refusePreview(locals: HollwarePreviewLocals, error: unknown): void {
  if (isPreviewRefusal(error)) locals.hollwarePreviewRefused = true
}
