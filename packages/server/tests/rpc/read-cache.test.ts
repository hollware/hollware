import { describe, expect, it } from 'vite-plus/test'

import { createReadCache } from '../../src/rpc/read-cache.ts'

function counted(answer: string) {
  const calls = { n: 0 }
  return {
    calls,
    read: () => {
      calls.n += 1
      return Promise.resolve(answer)
    },
  }
}

describe('the read cache', () => {
  it('reads a key once and answers the kept answer after', async () => {
    const cache = createReadCache()
    const { calls, read } = counted('one')

    const answers = [await cache.remember('k', read), await cache.remember('k', read)]

    expect(answers).toEqual(['one', 'one'])
    expect(calls.n).toBe(1)
  })

  it('forgets a read that fails, so the next call reads again', async () => {
    const cache = createReadCache()
    const failing = () => Promise.reject(new Error('down'))
    const { calls, read } = counted('back')

    await expect(cache.remember('k', failing)).rejects.toThrow('down')

    expect(await cache.remember('k', read)).toBe('back')
    expect(calls.n).toBe(1)
  })

  it('drops the key used longest ago once it keeps more than its limit', async () => {
    const cache = createReadCache(2)
    const a = counted('a')
    const b = counted('b')
    const c = counted('c')
    await cache.remember('a', a.read)
    await cache.remember('b', b.read)
    await cache.remember('a', a.read)

    await cache.remember('c', c.read)
    await cache.remember('a', a.read)
    await cache.remember('b', b.read)

    expect([a.calls.n, b.calls.n, c.calls.n]).toEqual([1, 2, 1])
  })
})
