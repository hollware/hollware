import { HollwareError } from '@hollware/core'
import type { OperationContext } from './types.ts'

/**
 * The error of something that must never happen: a bug of Hollware, not a mistake of the caller.
 * Like the `internal` error of the adapters, its message says nothing about the cause, which goes
 * to the log through `cause`, and its fix names the request id the operator finds the log line by.
 */
export function internalError(context: OperationContext, cause: string): HollwareError {
  return new HollwareError(
    'internal',
    'The operation failed on the server.',
    `Try again. If it keeps failing, give the site operator this request id: ${context.requestId}.`,
    { cause: new Error(cause) },
  )
}

/**
 * The error for an answer of the store that the call it came from can never get: an entry that
 * is created cannot conflict, a publish has no slug to take. It is a bug, not an outcome of the
 * operation, so it is not one of the outcomes of its spec.
 */
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
