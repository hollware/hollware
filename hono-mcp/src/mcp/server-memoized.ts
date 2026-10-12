import type { McpRequestContext, McpServer } from '@modelcontextprotocol/server'
import { memoizeSchemas } from './memoize.ts'
import { SCHEMAS } from './schemas.ts'
import { buildServer } from './server.ts'

/** Zod validates, JSON Schema is converted once per isolate (see memoize.ts). */
const MEMOIZED_SCHEMAS = memoizeSchemas(SCHEMAS)

export function buildMemoizedServer(context?: McpRequestContext): McpServer {
  return buildServer(context, MEMOIZED_SCHEMAS)
}
