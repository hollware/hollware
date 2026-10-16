import { createHollware } from '@hollware/server'

// This file is the whole Worker. Your sites, their collections and their rules live in the
// database: shape them in the admin at /admin/, or have an agent do it over MCP. No deploy.
const hollware = createHollware()

// MCP for your agents at /mcp, behind a personal token.
export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
  queue: hollware.queue,
} satisfies ExportedHandler<Env>

// What your sites read over a service binding: read-only methods, no network, no token.
export class Hollware extends hollware.Hollware {}
