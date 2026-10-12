import { createBaseApp } from './app.ts'
import { mountRuntimeReport } from './runtime-report.ts'
import { mcpRoute } from './mcp/route.ts'
import { buildPrecomputedServer } from './mcp/server-precomputed.ts'

// The fallback Worker: MCP on /mcp with precomputed JSON Schemas (fromJsonSchema), no Zod per request.
const app = createBaseApp()
app.all('/mcp', mcpRoute(buildPrecomputedServer))
mountRuntimeReport(app)

export default app
