import { HollwareError } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { insufficientScope } from '../auth/index.ts'
import type { HollwareEnv, HollwareRpc } from '../index.ts'
import type { Proceed } from '../oauth/server.ts'
import type { GatewayEnv } from './types.ts'

/**
 * The HTTP read API (v0.2): the four read methods of the RPC binding, for a site that is not a
 * Worker of the same account. It serves published content only, to a personal token or an OAuth
 * access token with `content:read` (ADR-026), and answers with an ETag, so that a client revalidates instead of reading the
 * body again (304). Its responses are private: they are behind a token, so no shared cache keeps
 * them. The OpenAPI document is at `/v1/openapi.json`.
 *
 *   GET /v1/site                                   describe_site
 *   GET /v1/{collection}?locale&tag&limit&cursor   list_entries
 *   GET /v1/{collection}/translations/{group}      get_translations
 *   GET /v1/{collection}/{locale}/{slug}?formats=  get_entry (formats: markdown,document,html)
 */

export interface ReadApiOptions {
  /** The read methods over the bindings of a request: the RPC surface itself. */
  readonly read: (env: HollwareEnv) => HollwareRpc
  readonly site: string
  /** The resource server of `/v1`, which turns a request without an accepted token away. */
  readonly protect: (c: Context<GatewayEnv>, proceed: Proceed) => Promise<Response>
  /** The protected resource metadata of `/v1`, which a 403 names. */
  readonly metadataUrl: (c: Context<GatewayEnv>) => string
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
    return options.protect(c, async (principal) => {
      if (!principal.scopes.includes('content:read')) {
        return insufficientScope(['content:read'], options.metadataUrl(c))
      }
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
    })
  })

  app.get('/v1/openapi.json', (c) => c.json(openApiDocument(options.site)))
  app.get('/v1/site', async (c) => answer(c, await options.read(c.env).describeSite(options.site)))
  app.get('/v1/:collection', async (c) => {
    const query = c.req.query()
    const limit = query['limit'] === undefined ? undefined : Number(query['limit'])
    return answer(
      c,
      await options.read(c.env).listEntries(options.site, c.req.param('collection'), {
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
        .getTranslations(options.site, c.req.param('collection'), c.req.param('group')),
    ),
  )
  app.get('/v1/:collection/:locale/:slug', async (c) => {
    const formats = c.req.query('formats')
    return answer(
      c,
      await options.read(c.env).getEntry(
        options.site,
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
export function openApiDocument(site: string): object {
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
    info: { title: `Hollware read API (${site})`, version: '1' },
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
