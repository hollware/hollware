import { authErrorResponse } from './responses.ts'

/** The host (with its port, unless it is the scheme's default) and the origin of a public URL. */
interface PublicUrl {
  readonly host: string
  /**
   * The same host with the default port of its scheme written out (`cms.example.com:443`), which
   * names the same server; `null` when the URL has a port of its own.
   */
  readonly hostWithDefaultPort: string | null
  readonly origin: string
}

/**
 * What the Host and Origin of a request are compared with: the host and the origin that `new URL`
 * makes of the variable (lowercase, no default port). Path, query and fragment play no part.
 * `null` when the variable is not an absolute `http` or `https` URL, or is not a string at all.
 */
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

/**
 * The guard that runs in front of every route, against DNS rebinding and cross-site requests
 * from a browser (ADR-019). It fails closed: every request it does not recognize is refused.
 *
 * - `HOLLWARE_PUBLIC_URL` missing or not an `http` or `https` URL: 500. Without it nothing can
 *   be compared, and skipping the check would leave the Worker open.
 * - A `Host` header that is missing, or is not the host of the public URL, port included: 403.
 *   The comparison ignores case, and takes the default port of the scheme written out
 *   (`cms.example.com:443` for an `https` URL), which some clients send for the same server.
 *   Any other port is another host.
 * - An `Origin` header that is present and is not the origin of the public URL, scheme and port
 *   included: 403. That covers the opaque `null` origin and an empty value. A request without
 *   `Origin` passes: only browsers send it, and they are what the check is for. The one exception
 *   is `crossOrigin`: an origin it accepts passes too (the read API, for the origins a site's
 *   config lists; the read API then checks the origin against the site of the token).
 *
 * It returns the response to send, or `null` when the request may go on. No answer repeats the
 * request: the 403s say what to send instead, and the 500 only says what is missing.
 *
 * The helpers of the MCP SDK (`hostHeaderValidationResponse`, `originValidationResponse`) do not
 * fit: they compare hostnames only, so they accept any port and, for `Origin`, any scheme, and
 * they accept a `Host` such as `user@cms.example.com` or `cms.example.com/x`.
 *
 * @param publicUrl The `HOLLWARE_PUBLIC_URL` variable as the environment holds it.
 * @param crossOrigin Whether a request may come from a page of another origin; never, by default.
 */
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
