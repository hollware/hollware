import { describe, expect, it } from 'vite-plus/test'

import { isStaleFile, loadAgainOnce } from '../app/lib/stale.ts'

describe('a file of the code that failed to load', () => {
  it('is told from other errors, in the words of each browser', () => {
    expect(
      isStaleFile(
        new TypeError(
          'Failed to fetch dynamically imported module: https://cms.test/admin/assets/Entries-a.js',
        ),
      ),
    ).toBe(true)
    expect(isStaleFile(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isStaleFile(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleFile(new Error('Unable to preload CSS for /admin/assets/x.css'))).toBe(true)
    expect(isStaleFile(new Error('The server answered 500.'))).toBe(false)
  })

  it('loads the page again, at most once in ten seconds', () => {
    const kept = new Map<string, string>()
    const storage = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }
    let loads = 0
    const load = () => void loads++

    expect(loadAgainOnce(storage, 100_000, load)).toBe(true)
    expect(loadAgainOnce(storage, 109_999, load)).toBe(false)
    expect(loadAgainOnce(storage, 110_000, load)).toBe(true)
    expect(loads).toBe(2)
  })
})
