import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '@modelcontextprotocol/server'
import {
  ALWAYS_FAILS_ANNOTATIONS,
  CREATE_NOTE_ANNOTATIONS,
  ECHO_ANNOTATIONS,
  alwaysFails,
  createNote,
  echo,
} from './handlers.ts'
import type { AlwaysFailsInput, CreateNoteInput, EchoInput } from './handlers.ts'
import { PRECOMPUTED_SCHEMAS } from './schemas.generated.ts'
import { SERVER_INFO, TOOLS_LIST_CACHE_HINT } from './server.ts'

/**
 * `fromJsonSchema` compiles a validator per call (getValidator), so the wrappers are built once
 * per isolate and shared by every request's server.
 */
export function createPrecomputedWrappers() {
  return {
    alwaysFails: {
      input: fromJsonSchema<AlwaysFailsInput>(PRECOMPUTED_SCHEMAS.always_fails.input),
      output: fromJsonSchema<unknown>(PRECOMPUTED_SCHEMAS.always_fails.output),
    },
    createNote: {
      input: fromJsonSchema<CreateNoteInput>(PRECOMPUTED_SCHEMAS.create_note.input),
      output: fromJsonSchema<unknown>(PRECOMPUTED_SCHEMAS.create_note.output),
    },
    echo: {
      input: fromJsonSchema<EchoInput>(PRECOMPUTED_SCHEMAS.echo.input),
      output: fromJsonSchema<unknown>(PRECOMPUTED_SCHEMAS.echo.output),
    },
  }
}

export type PrecomputedWrappers = ReturnType<typeof createPrecomputedWrappers>

const WRAPPERS = createPrecomputedWrappers()

/**
 * The fallback of ADR-012: the same three tools, registered through `fromJsonSchema` with JSON
 * Schemas computed ahead of time. No Zod runs per request; validation is the runtime-selected
 * JSON Schema validator (@cfworker/json-schema on workerd), so Zod defaults are NOT applied.
 */
export function buildPrecomputedServer(
  _context?: McpRequestContext,
  wrappers: PrecomputedWrappers = WRAPPERS,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    cacheHints: { 'tools/list': TOOLS_LIST_CACHE_HINT },
  })

  server.registerTool(
    'always_fails',
    {
      title: 'Always fails',
      description: 'Fails with a tool error, either returned or thrown.',
      inputSchema: wrappers.alwaysFails.input,
      outputSchema: wrappers.alwaysFails.output,
      annotations: ALWAYS_FAILS_ANNOTATIONS,
    },
    (input) => alwaysFails(input),
  )

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description: 'Creates a note and returns it as structured output.',
      inputSchema: wrappers.createNote.input,
      outputSchema: wrappers.createNote.output,
      annotations: CREATE_NOTE_ANNOTATIONS,
    },
    (input) => createNote(input),
  )

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echoes the message back with its length.',
      inputSchema: wrappers.echo.input,
      outputSchema: wrappers.echo.output,
      annotations: ECHO_ANNOTATIONS,
    },
    (input) => echo(input),
  )

  return server
}
