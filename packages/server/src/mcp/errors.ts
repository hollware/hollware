import { HollwareError, type Effect, type Operation } from '@hollware/core'

/**
 * The error a caller gets for anything that is not a `HollwareError`. The message is fixed: what
 * went wrong goes to the log and never to the caller, whose agent could repeat it to a person or
 * to another system. The request id is how the operator finds the log line.
 */
export function internalError(requestId: string, cause: unknown): HollwareError {
  return new HollwareError(
    'internal',
    'The operation failed on the server.',
    `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
    { cause },
  )
}

/** The fix of `timeout`, by effect: a write that ran out of time may still finish. */
const TIMEOUT_FIX = {
  read: 'Try again. If it keeps timing out, ask for less.',
  edit: 'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
  write:
    'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
  destructive:
    'The change may still be applied after this answer: read the entry with get_entry before you repeat the call.',
} as const satisfies Record<Effect, string>

export function timeoutError(spec: Operation, timeoutMs: number): HollwareError {
  return new HollwareError(
    'timeout',
    `${spec.name} did not finish within ${timeoutMs} ms.`,
    TIMEOUT_FIX[spec.effect],
  )
}

/** A value that is not an error, as text: handlers may throw anything. */
function printable(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? typeof value
  } catch {
    return typeof value
  }
}

/**
 * What the operator needs to know about an error, for the log: its stack (or its type and
 * message), then the same for each cause. It is never sent to the caller.
 */
export function describeError(error: unknown): string {
  const lines: string[] = []
  let current: unknown = error
  // A cause chain can loop; five links are more than any real one.
  for (let depth = 0; depth < 5 && current !== undefined; depth++) {
    if (current instanceof Error) {
      lines.push(current.stack ?? `${current.name}: ${current.message}`)
      current = current.cause
    } else {
      lines.push(printable(current))
      current = undefined
    }
  }
  return lines.join('\ncaused by: ')
}
