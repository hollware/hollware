import { HollwareError } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import type { HollwareEnv, HollwareRpc } from '../index.ts'
import type { Proceed } from '../oauth/server.ts'
import type { GatewayEnv } from './types.ts'

/**
 * The HTTP read API (v0.2): the four read methods of the RPC binding, for a site that is not a
 * Worker of the same account. It serves published content only, to a personal token, a read token
 * (`hw_read_`) or an OAuth access token with `content:read` (ADR-026), of one site, and answers
 * with an ETag, so that a client revalidates instead of reading the body again (304). Its
 * responses are private: they are behind a token, so no shared cache keeps them. A page of an
 * origin that the site's config lists (`cors.origins`) may call it from the browser; any other
 * origin is refused. The OpenAPI document is at `/v1/openapi.json`.
 *
 *   GET /v1/site                                   describe_site
 *   GET /v1/{collection}?locale&tag&limit&cursor   list_entries
 *   GET /v1/{collection}/translations/{group}      get_translations
 *   GET /v1/{collection}/{locale}/{slug}?formats=  get_entry (formats: markdown,document,html)
 */

export interface ReadApiOptions {
  /** The read methods over the bindings of a request: the RPC surface itself. */
  readonly read: (env: HollwareEnv) => HollwareRpc
  /** The resource server of `/v1`, which turns a request without an accepted token away. */
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  /** The protected resource metadata of `/v1`, which a 403 names. */
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
  /** The origins whose pages may read a site from the browser (`cors.origins` of its config). */
  readonly corsOrigins: (site: string) => readonly string[]
  /** Whether any site lists the origin: a preflight carries no token to tell the site by. */
  readonly anyCorsOrigin: (origin: string) => boolean
}

/** How long a browser keeps the answer of a preflight, in seconds. */
const PREFLIGHT_MAX_AGE = 600

/** The origin of a request from a page of another origin than Hollware's own, or `null`. */
function crossOriginOf(c: Context<GatewayEnv>): string | null {
  const origin = c.req.header('origin')
  if (origin === undefined) return null
  return origin.toLowerCase() === new URL(c.env.HOLLWARE_PUBLIC_URL).origin ? null : origin
}

const STATUS: Readonly<Record<string, 400 | 404 | 500>> = {
  invalid_input: 400,
  unknown_collection: 404,
  unknown_locale: 404,
}

/** A weak ETag of a body: the first 128 bits of its SHA-256, in hex. */
async function etagOf(body: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)),
  )
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0'))
  return `W/"${hex.join('')}"`
}

/** Whether `If-None-Match` names this ETag, or is `*`. */
function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false
  return header
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || tag === etag || `W/${tag}` === etag)
}

async function answer(c: Context<GatewayEnv>, value: unknown): Promise<Response> {
  const notFound =
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    value.outcome === 'not_found'
  const body = JSON.stringify(value)
  const etag = await etagOf(body)
  const headers = { etag, 'cache-control': 'private, no-cache', 'content-type': 'application/json' }
  if (!notFound && matches(c.req.header('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(body, { status: notFound ? 404 : 200, headers })
}

export function installReadApi(app: Hono<GatewayEnv>, options: ReadApiOptions): void {
  app.use('/v1/*', async (c, next) => {
    // The operations over HTTP and the admin's own routes have routes of their own.
    if (c.req.path.startsWith('/v1/ops/') || c.req.path.startsWith('/v1/admin/')) return next()
    const crossOrigin = crossOriginOf(c)
    if (c.req.method === 'OPTIONS') {
      // A preflight: the guard let it through only for an origin that some site lists.
      const headers = new Headers({ allow: 'GET, HEAD, OPTIONS', vary: 'Origin' })
      if (crossOrigin !== null && options.anyCorsOrigin(crossOrigin)) {
        headers.set('access-control-allow-origin', crossOrigin)
        headers.set('access-control-allow-methods', 'GET, HEAD')
        headers.set('access-control-allow-headers', 'authorization, if-none-match')
        headers.set('access-control-max-age', String(PREFLIGHT_MAX_AGE))
      }
      return new Response(null, { status: 204, headers })
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      return c.json(
        { code: 'invalid_input', message: 'The read API only reads.', fix: 'Use GET.' },
        405,
        {
          allow: 'GET, HEAD',
        },
      )
    }
    if (c.req.path === '/v1/openapi.json') return next()
    const response = await options.protect(c, async (principal) => {
      if (!principal.scopes.includes('content:read')) {
        return insufficientScope(['content:read'], options.metadataUrl(c))
      }
      // A token belongs to one site, and the read API reads that site.
      c.set('site', principal.site)
      if (crossOrigin !== null && !options.corsOrigins(principal.site).includes(crossOrigin)) {
        return c.json(
          {
            code: 'forbidden_origin',
            message: `The site "${principal.site}" does not let pages of ${crossOrigin} read it.`,
            fix: `Add "${crossOrigin}" to cors.origins of the site in hollware.config.ts, or read from a server.`,
          },
          403,
          // Hollware's own origin, so that the OAuth library reflects no other one onto it.
          {
            vary: 'Origin',
            'access-control-allow-origin': new URL(c.env.HOLLWARE_PUBLIC_URL).origin,
          },
        )
      }
      const answered = await (async () => {
        try {
          await next()
          return c.res
        } catch (error) {
          if (!(error instanceof HollwareError)) throw error
          return c.json(
            { code: error.code, message: error.message, fix: error.fix },
            STATUS[error.code] ?? 500,
          )
        }
      })()
      if (crossOrigin === null) return answered
      // The page may read the answer, and its ETag, to revalidate.
      const shared = new Response(answered.body, answered)
      shared.headers.set('access-control-allow-origin', crossOrigin)
      shared.headers.set('access-control-expose-headers', 'etag')
      shared.headers.append('vary', 'Origin')
      return shared
    })
    // Once the route has answered, Hono keeps `c.res` and drops what a middleware returns: the
    // answer, with the headers added around it, goes back through `c.res`.
    c.res = response
    return c.res
  })

  app.get('/v1/openapi.json', (c) => c.json(openApiDocument()))
  app.get('/v1/site', async (c) => answer(c, await options.read(c.env).describeSite(c.get('site'))))
  app.get('/v1/:collection', async (c) => {
    const query = c.req.query()
    const limit = query['limit'] === undefined ? undefined : Number(query['limit'])
    return answer(
      c,
      await options.read(c.env).listEntries(c.get('site'), c.req.param('collection'), {
        ...(query['locale'] === undefined ? {} : { locale: query['locale'] }),
        ...(query['tag'] === undefined ? {} : { tag: query['tag'] }),
        ...(limit === undefined ? {} : { limit }),
        ...(query['cursor'] === undefined ? {} : { cursor: query['cursor'] }),
      }),
    )
  })
  app.get('/v1/:collection/translations/:group', async (c) =>
    answer(
      c,
      await options
        .read(c.env)
        .getTranslations(c.get('site'), c.req.param('collection'), c.req.param('group')),
    ),
  )
  app.get('/v1/:collection/:locale/:slug', async (c) => {
    const formats = c.req.query('formats')
    return answer(
      c,
      await options.read(c.env).getEntry(
        c.get('site'),
        c.req.param('collection'),
        c.req.param('slug'),
        c.req.param('locale'),
        formats === undefined
          ? {}
          : {
              formats: formats
                .split(',')
                .flatMap((format) =>
                  format === 'markdown' || format === 'document' || format === 'html'
                    ? [format]
                    : [],
                ),
            },
      ),
    )
  })
}

/** The OpenAPI 3.1 document of the read API. */
export function openApiDocument(): object {
  const ok = (description: string) => ({
    description,
    headers: { ETag: { schema: { type: 'string' } } },
    content: { 'application/json': { schema: { type: 'object' } } },
  })
  const common = {
    '304': { description: 'Not modified: the ETag of If-None-Match is current.' },
    '401': {
      description:
        'No token, or one that is unknown, expired or revoked. The challenge names the protected resource metadata.',
    },
    '403': { description: 'The token lacks content:read.' },
  }
  const param = (name: string, location: 'path' | 'query', required: boolean) => ({
    name,
    in: location,
    required,
    schema: { type: 'string' },
  })
  return {
    openapi: '3.1.0',
    info: { title: 'Hollware read API', version: '1' },
    // A personal token, or an OAuth access token for this resource (ADR-026).
    components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
    security: [{ token: [] }],
    paths: {
      '/v1/site': {
        get: { operationId: 'describe_site', responses: { '200': ok('The site'), ...common } },
      },
      '/v1/{collection}': {
        get: {
          operationId: 'list_entries',
          parameters: [
            param('collection', 'path', true),
            param('locale', 'query', false),
            param('tag', 'query', false),
            param('limit', 'query', false),
            param('cursor', 'query', false),
          ],
          responses: { '200': ok('A page of published entries'), ...common },
        },
      },
      '/v1/{collection}/translations/{group}': {
        get: {
          operationId: 'get_translations',
          parameters: [param('collection', 'path', true), param('group', 'path', true)],
          responses: {
            '200': ok('The published entries of the group'),
            '404': { description: 'No such group' },
            ...common,
          },
        },
      },
      '/v1/{collection}/{locale}/{slug}': {
        get: {
          operationId: 'get_entry',
          parameters: [
            param('collection', 'path', true),
            param('locale', 'path', true),
            param('slug', 'path', true),
            param('formats', 'query', false),
          ],
          responses: {
            '200': ok('A published entry'),
            '404': { description: 'No such published entry' },
            ...common,
          },
        },
      },
    },
  }
}
