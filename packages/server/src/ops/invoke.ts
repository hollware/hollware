import type { Operation } from '@hollware/core'
import type { Handlers, OperationContext } from './types.ts'

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
