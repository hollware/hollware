import { createHollware } from '@hollware/server'
import config from '../hollware.config.ts'

// This file is the whole Worker: the config goes in, the Worker comes out.
const hollware = createHollware(config)

// MCP for your agents at /mcp, behind a personal token.
export default {
  fetch: hollware.fetch,
  scheduled: hollware.scheduled,
  queue: hollware.queue,
} satisfies ExportedHandler<Env>

// What your sites read over a service binding: four read-only methods, no network, no token.
export class Hollware extends hollware.Hollware {}
