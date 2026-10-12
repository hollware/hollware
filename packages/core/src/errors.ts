/**
 * The errors of an operation that are none of its outcomes: the caller asked for something it
 * cannot have, or the server could not answer. Conflicts, missing entries and blocked publishes
 * are outcomes, not errors (`operations/specs.ts`).
 */
export const ERROR_CODES = [
  /** The input breaks a rule the input schema cannot express. */
  'invalid_input',
  /** The input names a collection the site does not have. */
  'unknown_collection',
  /** The input names a locale the site does not have. */
  'unknown_locale',
  /** The token lacks a scope the operation requires; the message names every missing scope. */
  'insufficient_scope',
  /** The answer would exceed the output cap. Hollware never truncates content. */
  'output_too_large',
  /** The operation ran out of time. */
  'timeout',
  /** Anything else. The message says nothing about the cause, which goes to the log. */
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
