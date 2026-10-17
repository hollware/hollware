import { getRequestURL, type H3Event } from 'h3'

/**
 * The URL the visitor asked for. On Workers it is the one of the Request itself, whose scheme and
 * host are the real ones; elsewhere h3 builds it from the `Host` header.
 */
export function requestUrl(event: H3Event): URL {
  const request: unknown = event.context['cloudflare']?.request
  const url =
    typeof request === 'object' && request !== null ? Reflect.get(request, 'url') : undefined
  return typeof url === 'string' ? new URL(url) : getRequestURL(event)
}
