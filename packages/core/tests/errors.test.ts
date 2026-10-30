import { describe, expect, it } from 'vite-plus/test'

import { ERROR_CODES, HollwareError } from '../src/errors.ts'

describe('HollwareError', () => {
  it('has the error codes of the operations', () => {
    expect(ERROR_CODES).toEqual([
      'invalid_input',
      'unknown_collection',
      'unknown_locale',
      'invalid_preview',
      'insufficient_scope',
      'unauthorized',
      'output_too_large',
      'timeout',
      'internal',
    ])
  })

  it('carries a code, a message and a fix, and keeps its cause out of the message', () => {
    const cause = new Error('D1_ERROR: no such table: entries')
    const error = new HollwareError(
      'internal',
      'The operation failed.',
      'Try again; if it keeps failing, report it.',
      { cause },
    )
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('HollwareError')
    expect(error.code).toBe('internal')
    expect(error.message).toBe('The operation failed.')
    expect(error.fix).toBe('Try again; if it keeps failing, report it.')
    expect(error.cause).toBe(cause)
  })
})
