import { HollwareError, listEntries } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { describeError, internalError, timeoutError } from '../../src/mcp/errors.ts'

describe('internalError', () => {
  it('is a HollwareError with a fixed message, the request id in the fix, and the cause kept', () => {
    const cause = new Error('D1_ERROR: no such table: entries')

    const error = internalError('req_9', cause)

    expect(error).toBeInstanceOf(HollwareError)
    expect(error.code).toBe('internal')
    expect(error.message).toBe('The operation failed on the server.')
    expect(error.fix).toBe(
      'Try again. If it keeps failing, give the site operator this request id: req_9.',
    )
    expect(error.cause).toBe(cause)
  })
})

describe('timeoutError', () => {
  it('names the operation and how long it was given', () => {
    const error = timeoutError(listEntries, 30)

    expect(error).toBeInstanceOf(HollwareError)
    expect(error.code).toBe('timeout')
    expect(error.message).toBe('list_entries did not finish within 30 ms.')
    expect(error.fix).toBe('Try again. If it keeps timing out, ask for less.')
  })
})

describe('describeError', () => {
  it('prints the stack of an error, then of each cause', () => {
    const root = new RangeError('the row is too big')
    const middle = new Error('the write failed', { cause: root })
    const top = new HollwareError('internal', 'It failed.', 'Try again.', { cause: middle })

    const text = describeError(top)

    const parts = text.split('\ncaused by: ')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toContain('It failed.')
    expect(parts[1]).toContain('Error: the write failed')
    expect(parts[2]).toContain('RangeError: the row is too big')
  })

  it('stops after five links when a cause points back at an earlier one', () => {
    const loop = new Error('a loop')
    loop.cause = loop

    const parts = describeError(loop).split('\ncaused by: ')

    expect(parts).toHaveLength(5)
  })

  it.each([
    ['a string', 'plain words', 'plain words'],
    ['an object', { code: 'EWEIRD', retry: false }, '{"code":"EWEIRD","retry":false}'],
    ['a number', 42, '42'],
    ['null', null, 'null'],
    ['a bigint, which JSON cannot hold', 10n, 'bigint'],
    ['a function, which JSON leaves out', () => 1, 'function'],
  ])('prints %s that was thrown instead of an error', (_label, thrown, text) => {
    expect(describeError(thrown)).toBe(text)
  })

  it('prints a cause that is not an error after the error that holds it', () => {
    const error = new Error('the write failed', { cause: 'the disk said no' })

    const parts = describeError(error).split('\ncaused by: ')

    expect(parts[0]).toContain('Error: the write failed')
    expect(parts[1]).toBe('the disk said no')
  })

  it('falls back to the type and the message of an error that has no stack', () => {
    const error = new TypeError('no stack here')
    error.stack = undefined

    expect(describeError(error)).toBe('TypeError: no stack here')
  })

  it('has nothing to say of nothing', () => {
    expect(describeError(undefined)).toBe('')
  })
})
