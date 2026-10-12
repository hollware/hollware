import { McpServer } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import {
  ALWAYS_FAILS_ANNOTATIONS,
  CREATE_NOTE_ANNOTATIONS,
  ECHO_ANNOTATIONS,
  alwaysFails,
  createNote,
  echo,
} from './handlers.ts'
import type { Memoized } from './memoize.ts'
import { SCHEMAS } from './schemas.ts'
import type { Schemas } from './schemas.ts'

export const SERVER_INFO = { name: 'spike-hono-mcp', version: '0.0.0' } as const

/** Emitted as ttlMs / cacheScope on tools/list results of the 2026-07-28 era only. */
export const TOOLS_LIST_CACHE_HINT = { ttlMs: 60_000, cacheScope: 'public' } as const

/**
 * The MCP server factory: createMcpHandler calls it once per HTTP request. McpServerFactory is
 * `(ctx: McpRequestContext) => McpServer | Server | Promise<...>`, and a zero-argument function fits.
 *
 * The SDK lists tools in registration order, it does not sort. Register alphabetically.
 */
export function buildServer(
  _context?: McpRequestContext,
  schemas: Schemas | Memoized<Schemas> = SCHEMAS,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    // A server built per request can never push tools/list_changed.
    capabilities: { tools: { listChanged: false } },
    cacheHints: { 'tools/list': TOOLS_LIST_CACHE_HINT },
  })

  server.registerTool(
    'always_fails',
    {
      title: 'Always fails',
      description: 'Fails with a tool error, either returned or thrown.',
      inputSchema: schemas.alwaysFailsInput,
      outputSchema: schemas.alwaysFailsOutput,
      annotations: ALWAYS_FAILS_ANNOTATIONS,
    },
    (input) => alwaysFails(input),
  )

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description: 'Creates a note and returns it as structured output.',
      inputSchema: schemas.createNoteInput,
      outputSchema: schemas.createNoteOutput,
      annotations: CREATE_NOTE_ANNOTATIONS,
    },
    (input) => createNote(input),
  )

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes the message back with its length.',
      inputSchema: schemas.echoInput,
      outputSchema: schemas.echoOutput,
      annotations: ECHO_ANNOTATIONS,
    },
    (input) => echo(input),
  )

  return server
}
