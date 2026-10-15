import type { Operation } from '@hollware/core'
import type { Handlers, OperationContext } from './types.ts'

/**
 * Calls the handler of an operation. This is the one place where the typed pairing of specs and
 * handlers meets a dynamic caller (MCP, the ops API): the caller parsed `input` with the input
 * schema of `spec`, which is the schema that types the handler of the same name.
 */
export function invoke(
  handlers: Handlers,
  spec: Operation,
  input: unknown,
  context: OperationContext,
): Promise<unknown> {
  const handler = handlers[spec.name] as (
    input: unknown,
    context: OperationContext,
  ) => Promise<unknown>
  return handler(input, context)
}
