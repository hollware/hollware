import { exchangeHeaders, exchangePreviewLink } from '@hollware/client'
import { defineEventHandler, sendRedirect, setResponseHeader } from 'h3'
import { requestUrl } from './url.ts'

export default defineEventHandler((event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return
  const url = requestUrl(event)
  if (url.pathname.startsWith('/_hollware/')) return
  const exchange = exchangePreviewLink(url)
  if (exchange === undefined) return
  for (const [name, value] of exchangeHeaders(exchange, url)) {
    if (name !== 'location') setResponseHeader(event, name, value)
  }
  return sendRedirect(event, exchange.location, 303)
})
