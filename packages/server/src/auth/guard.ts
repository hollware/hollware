import { authErrorResponse } from './responses.ts'

interface PublicUrl {
  readonly host: string
  readonly hostWithDefaultPort: string | null
  readonly origin: string
}

function readPublicUrl(value: unknown): PublicUrl | null {
  if (typeof value !== 'string') return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return {
    host: url.host,
    hostWithDefaultPort:
      url.port === '' ? `${url.host}:${url.protocol === 'https:' ? 443 : 80}` : null,
    origin: url.origin,
  }
}

export function checkHostAndOrigin(
  request: Request,
  publicUrl: unknown,
  crossOrigin: (request: Request, origin: string) => boolean = () => false,
): Response | null {
  const expected = readPublicUrl(publicUrl)
  if (expected === null) {
    return authErrorResponse(500, {
      code: 'misconfigured',
      message: 'HOLLWARE_PUBLIC_URL is required: it is missing, or it is not an http or https URL.',
      fix: 'Set the HOLLWARE_PUBLIC_URL variable of the Worker to its public URL, such as https://cms.example.com, and deploy again.',
    })
  }
  const host = request.headers.get('host')?.toLowerCase() ?? null
  if (host === null || (host !== expected.host && host !== expected.hostWithDefaultPort)) {
    return authErrorResponse(403, {
      code: 'forbidden_host',
      message: 'The Host header of the request is not the public URL of this Hollware.',
      fix: `Send the request to ${expected.origin}, the public URL of this Hollware (HOLLWARE_PUBLIC_URL).`,
    })
  }
  const origin = request.headers.get('origin')
  if (
    origin !== null &&
    origin.toLowerCase() !== expected.origin &&
    !crossOrigin(request, origin)
  ) {
    return authErrorResponse(403, {
      code: 'forbidden_origin',
      message: 'The Origin header of the request is not the public URL of this Hollware.',
      fix: `Call Hollware from a client that sends no Origin header, or from a page served at ${expected.origin}.`,
    })
  }
  return null
}
