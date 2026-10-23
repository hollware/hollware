import { HollwareError, type Effect, type Operation } from '@hollware/core'

export function internalError(requestId: string, cause: unknown): HollwareError {
  return new HollwareError(
    'internal',
    'The operation failed on the server.',
    `Try again. If it keeps failing, give the site operator this request id: ${requestId}.`,
    { cause },
  )
}

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

function printable(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? typeof value
  } catch {
    return typeof value
  }
}

export function describeError(error: unknown): string {
  const lines: string[] = []
  let current: unknown = error
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
