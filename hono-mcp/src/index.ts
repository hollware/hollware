import { createBaseApp } from './app.ts'
import { mountRuntimeReport } from './runtime-report.ts'
import { buildServer } from './mcp/server.ts'
import { mcpRoute } from './mcp/route.ts'

// The S2 Worker: the S1 Hono 5 app plus MCP on /mcp, tools from Zod schemas.
const app = createBaseApp()
app.all('/mcp', mcpRoute(buildServer))
mountRuntimeReport(app)

export default app
