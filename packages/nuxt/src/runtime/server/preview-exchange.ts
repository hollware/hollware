import { exchangeHeaders, exchangePreviewLink } from '@hollware/client'
import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import { requestUrl } from './url.ts'

/**
 * The link of the admin's "Preview on the site" (`?hollware-preview=<token>`) is exchanged for a
 * cookie, so the token is in a URL once: a `303` to the same URL without the parameter, with the
 * token in `hollware_preview` (HttpOnly, SameSite=Lax, an hour, Secure but on http://localhost and
 * http://127.0.0.1), `no-store` and `Referrer-Policy: no-referrer`. The token is not checked here:
 * Hollware does, when the page reads. A value not shaped like a token sets no cookie.
 */

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const url = requestUrl(event)
  // The module's own routes take no link: pages do.
  if (url.pathname.startsWith('/_hollware/')) return
  const exchange = exchangePreviewLink(url)
  if (exchange === undefined) return
  for (const [name, value] of exchangeHeaders(exchange, url)) {
    if (name !== 'location') setResponseHeader(event, name, value)
  }
  return sendRedirect(event, exchange.location, 303)
})
