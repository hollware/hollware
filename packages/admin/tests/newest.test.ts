import { describe, expect, it } from 'vite-plus/test'

import { newestOnly } from '../app/lib/newest.ts'

function later<T>() {
  let settle: (value: T) => void = () => undefined
  let fail: (error: Error) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  return { promise, settle, fail }
}

describe('only the newest answer counts', () => {
  it('drops an answer that arrives after a newer request', async () => {
    const newest = newestOnly()
    const old = later<string>()
    const recent = later<string>()
    const first = newest.run(() => old.promise)
    const second = newest.run(() => recent.promise)
    recent.settle('recent')
    old.settle('old')
    expect(await second).toEqual({ value: 'recent' })
    expect(await first).toBeNull()
  })

  it('drops an answer asked before a skip', async () => {
    const newest = newestOnly()
    const pending = later<string>()
    const answer = newest.run(() => pending.promise)
    newest.skip()
    pending.settle('stale')
    expect(await answer).toBeNull()
  })

  it('answers nothing when the request fails, and never throws', async () => {
    const newest = newestOnly()
    const pending = later<string>()
    const answer = newest.run(() => pending.promise)
    pending.fail(new Error('offline'))
    expect(await answer).toBeNull()
  })
})
