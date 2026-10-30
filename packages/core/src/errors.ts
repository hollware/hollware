export const ERROR_CODES = [
  'invalid_input',
  'unknown_collection',
  'unknown_locale',
  'invalid_preview',
  'insufficient_scope',
  'unauthorized',
  'output_too_large',
  'timeout',
  'internal',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * An error that the caller sees: a code, a message for the agent and a fix it can act on. The
 * cause, when there is one, is for the log only and never reaches the caller.
 */
export class HollwareError extends Error {
  override readonly name = 'HollwareError'
  readonly code: ErrorCode
  readonly fix: string

  constructor(code: ErrorCode, message: string, fix: string, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
    this.fix = fix
  }
}
