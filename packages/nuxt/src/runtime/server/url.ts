import { getRequestURL, type H3Event } from 'h3'

export function requestUrl(event: H3Event): URL {
  const request: unknown = event.context['cloudflare']?.request
  const url =
    typeof request === 'object' && request !== null ? Reflect.get(request, 'url') : undefined
  return typeof url === 'string' ? new URL(url) : getRequestURL(event)
}
