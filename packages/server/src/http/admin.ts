import { PAGE_ISOLATION } from '../identity/pages.ts'
import { SCOPES } from '@hollware/core'
import type { Context, Hono } from 'hono'
import { adminClient } from '../oauth/admin.ts'
import type { OAuth } from '../oauth/server.ts'
import type { GatewayEnv } from './types.ts'

const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

function notInstalled(): Response {
  return Response.json(
    {
      code: 'not_found',
      message: 'The admin is not installed in this Worker.',
      fix: 'Bind the static assets as ASSETS and serve the files of @hollware/admin (adminAssets()), as the starter does.',
    },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  )
}

export const ADMIN_ICONS: ReadonlySet<string> = new Set([
  '/admin/favicon.ico',
  '/admin/favicon.svg',
  '/admin/apple-touch-icon.png',
])

async function ownIcon(url: string): Promise<Response> {
  const answer = await fetch(url)
  const type = answer.headers.get('content-type') ?? ''
  if (!answer.ok || !type.startsWith('image/')) {
    await answer.body?.cancel()
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } })
  }
  return new Response(answer.body, {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=3600',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
}

export function installAdmin(
  app: Hono<GatewayEnv>,
  options: { readonly oauth: (publicUrl: string) => OAuth; readonly favicon: string | null },
): void {
  app.get('/admin/config.json', async (c) => {
    const oauth = options.oauth(c.env.HOLLWARE_PUBLIC_URL)
    const client = await adminClient(oauth, c.env)
    return c.json(
      {
        issuer: oauth.issuer,
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        resource: oauth.resources.v1,
        scope: SCOPES.join(' '),
      },
      200,
      { 'cache-control': 'no-store' },
    )
  })

  const page = async (c: Context<GatewayEnv>) => {
    const assets = c.env.ASSETS
    if (assets === undefined) return notInstalled()
    const origin = options.oauth(c.env.HOLLWARE_PUBLIC_URL).issuer
    const answer = await assets.fetch(new Request(`${origin}/admin/`))
    if (!answer.ok) return notInstalled()
    const headers = new Headers(answer.headers)
    headers.set('content-security-policy', POLICY)
    headers.set('cache-control', 'no-store')
    headers.set('x-content-type-options', 'nosniff')
    headers.set('referrer-policy', 'no-referrer')
    for (const [name, value] of Object.entries(PAGE_ISOLATION)) headers.set(name, value)
    return new Response(answer.body, { status: 200, headers })
  }
  app.get('/admin', (c) => c.redirect('/admin/', 301))
  app.get('/admin/', page)
  app.get('/admin/*', async (c) => {
    if (options.favicon !== null && ADMIN_ICONS.has(c.req.path)) return ownIcon(options.favicon)
    if (/\.[a-z0-9]+$/i.test(c.req.path)) {
      const assets = c.env.ASSETS
      if (assets === undefined) return notInstalled()
      return assets.fetch(c.req.raw)
    }
    return page(c)
  })
}
