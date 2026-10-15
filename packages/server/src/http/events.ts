import type { ResolvedSite } from '@hollware/core'
import type { Hono } from 'hono'
import { analyticsWriterOf } from '../analytics/cloudflare.ts'
import type { GatewayEnv } from './types.ts'

/** The largest beacon the route reads: a site key and a path, with room to spare. */
export const MAX_BEACON_BYTES = 2048

/** The longest path a view may have. */
export const MAX_PATH_LENGTH = 512

/** The origins whose pages may count views of a site: its own URL and its `cors.origins`. */
export function pageOriginsOf(site: ResolvedSite): readonly string[] {
  return [...(site.url === null ? [] : [new URL(site.url).origin]), ...site.cors.origins]
}

function refusal(status: 400 | 403 | 413, code: string, message: string, fix: string): Response {
  return Response.json({ code, message, fix }, { status, headers: { 'cache-control': 'no-store' } })
}

/** The path of a view without its query and fragment, or `null` when it is no path. */
function pathOf(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  const { pathname } = new URL(value, 'https://hollware.invalid')
  return pathname.length > MAX_PATH_LENGTH ? null : pathname
}

/**
 * `POST /events`, the beacon of the sites (ADR-031): `{ "site": "<key>", "path": "/<path>" }`, sent
 * by a page with `navigator.sendBeacon`, so with no token. It counts a view of the path when the
 * page is of one of the site's origins (its URL or its `cors.origins`), and keeps the site, the
 * path and the country Cloudflare gives the request: never a cookie, an IP or a user agent. It
 * answers 204 whether or not the Worker has an `ANALYTICS` binding, so that a page cannot tell.
 */
export function installEvents(
  app: Hono<GatewayEnv>,
  options: { readonly sites: ReadonlyMap<string, ResolvedSite> },
): void {
  app.post('/events', async (c) => {
    const text = await c.req.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BEACON_BYTES) {
      return refusal(
        413,
        'too_large',
        `A beacon is at most ${MAX_BEACON_BYTES} bytes.`,
        'Send the site and the path of the page, and nothing else.',
      )
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    const key = typeof body === 'object' && body !== null && 'site' in body ? body.site : null
    const site = typeof key === 'string' ? options.sites.get(key) : undefined
    const path =
      typeof body === 'object' && body !== null && 'path' in body ? pathOf(body.path) : null
    if (site === undefined || path === null) {
      return refusal(
        400,
        'invalid_input',
        'A beacon is JSON with the key of a site this Hollware serves and the path of a page.',
        'Send { "site": "<site key>", "path": "/<path of the page>" }.',
      )
    }
    const origin = c.req.header('origin') ?? null
    if (origin === null || !pageOriginsOf(site).includes(origin)) {
      return refusal(
        403,
        'forbidden_origin',
        `Only pages of the site "${site.key}" count its views.`,
        `Set url of the site in hollware.config.ts to the origin of its pages, or add the origin to cors.origins.`,
      )
    }
    const cf: unknown = Reflect.get(c.req.raw, 'cf')
    const country =
      typeof cf === 'object' && cf !== null && 'country' in cf && typeof cf.country === 'string'
        ? cf.country
        : 'XX'
    analyticsWriterOf(c.env)?.record({ site: site.key, path, country })
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  })
}
