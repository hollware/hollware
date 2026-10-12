import { Hono } from 'hono'
import { approve } from './approve.ts'

/** The default handler of the provider: everything that is not an API route, the token endpoint or metadata. */
export const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => c.json({ name: 'hollware-spike-oauth', public: true }))

// What the built Worker really runs with: the tests run under a runner that turns Node APIs on.
app.get('/runtime', (c) =>
  c.json({
    nodejsCompat: Cloudflare.compatibilityFlags.nodejs_compat,
    nodejsCompatV2: Cloudflare.compatibilityFlags.nodejs_compat_v2,
    globalFetchStrictlyPublic: Cloudflare.compatibilityFlags.global_fetch_strictly_public,
    hasProcess: Reflect.has(globalThis, 'process'),
    hasBuffer: Reflect.has(globalThis, 'Buffer'),
  }),
)

app.get('/authorize', async (c) => {
  const approval = await approve(c.env.OAUTH_PROVIDER, c.req.raw)
  return 'redirectTo' in approval
    ? c.redirect(approval.redirectTo)
    : c.text(approval.message, approval.status)
})
