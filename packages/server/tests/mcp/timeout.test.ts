import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { within } from '../../src/mcp/timeout.ts'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('within', () => {
  it('passes on the value of work that finishes in time, and leaves no timer', async () => {
    let made = 0
    const result = within(Promise.resolve('done'), 1000, () => new Error(`made ${++made}`))

    await expect(result).resolves.toBe('done')
    expect(made).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('passes on the failure of work that fails in time, and leaves no timer', async () => {
    const result = within(
      Promise.reject(new Error('the work failed')),
      1000,
      () => new Error('late'),
    )

    await expect(result).rejects.toThrow('the work failed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives up with the error of onTimeout once the limit has passed, and not before', async () => {
    let settled = false
    const result = within(new Promise<never>(() => {}), 1000, () => new Error('out of time'))
    const outcome = result.then(
      () => (settled = true),
      () => (settled = true),
    )

    await vi.advanceTimersByTimeAsync(999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).rejects.toThrow('out of time')
    await outcome
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let a failure of the work after the timeout through as unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      let fail: (error: Error) => void = () => {}
      const work = new Promise<never>((_resolve, reject) => {
        fail = reject
      })
      const result = within(work, 10, () => new Error('out of time'))
      const expectation = expect(result).rejects.toThrow('out of time')
      await vi.advanceTimersByTimeAsync(10)
      await expectation

      fail(new Error('too late to matter'))
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
