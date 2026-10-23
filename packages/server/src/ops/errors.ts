import { HollwareError } from '@hollware/core'
import type { OperationContext } from './types.ts'

export function internalError(context: OperationContext, cause: string): HollwareError {
  return new HollwareError(
    'internal',
    'The operation failed on the server.',
    `Try again. If it keeps failing, give the site operator this request id: ${context.requestId}.`,
    { cause: new Error(cause) },
  )
}

export function unexpectedAnswer(
  context: OperationContext,
  call: string,
  answer: { readonly outcome: string },
): HollwareError {
  return internalError(
    context,
    `The store answered ${answer.outcome} to ${call}, which it never does.`,
  )
}
