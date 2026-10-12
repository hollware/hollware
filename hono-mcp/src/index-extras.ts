import { HTTPException } from 'hono/http-exception'
import { createBaseApp } from './app.ts'
import { mcpRoute } from './mcp/route.ts'
import { buildMrtrServer } from './mcp/server-mrtr.ts'
import { buildProgressServer } from './mcp/server-progress.ts'
import { buildScopedServer } from './mcp/server-scoped.ts'
import { buildServer } from './mcp/server.ts'
import { mountRuntimeReport } from './runtime-report.ts'

// The extras Worker: what the plan relies on beyond tools/list and tools/call, served by the built
// Worker in a real workerd with no Node.js compatibility. Test-only; not part of the size budget.
const app = createBaseApp()

app.all('/mcp', mcpRoute(buildServer))
app.all(
  '/progress',
  mcpRoute((context) => buildProgressServer(context)),
)
app.all('/mrtr', mcpRoute(buildMrtrServer))

// A stand-in for the gateway's token verification: the scopes come from a header. A real gateway
// verifies a bearer token here. Without it the SDK would let the request through (scopeChallenge only
// compares scopes when authInfo exists), so the gateway answers 401 itself.
app.use('/scoped', async (c, next) => {
  const scopes = c.req.header('x-test-scopes')
  if (scopes === undefined) {
    throw new HTTPException(401, {
      res: new Response('Unauthorized', {
        status: 401,
        headers: { 'www-authenticate': 'Bearer' },
      }),
    })
  }
  c.set('authInfo', {
    token: 'test-token',
    clientId: 'test-client',
    scopes: scopes.split(',').filter((scope) => scope !== ''),
  })
  await next()
})
app.all('/scoped', mcpRoute(buildScopedServer))

mountRuntimeReport(app)

export default app
