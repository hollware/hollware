import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  copyKeeper,
  dropWorkingCopy,
  isOlderCopy,
  keepWorkingCopy,
  readWorkingCopy,
  restoreOf,
  saveDelay,
  workingCopyKey,
  type CopyStorage,
} from '../app/lib/working-copy.ts'

function memory(
  entries: Record<string, string> = {},
): CopyStorage & { entries: Record<string, string> } {
  return {
    entries,
    getItem: (key) => entries[key] ?? null,
    setItem: (key, value) => {
      entries[key] = value
    },
    removeItem: (key) => {
      delete entries[key]
    },
  }
}

const throwing: CopyStorage = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('full')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('the working copy of an entry in the browser', () => {
  it('is kept, read and dropped under the key of its site and entry', () => {
    const storage = memory()
    const key = workingCopyKey('blog', 'ent_1')

    keepWorkingCopy(storage, key, { markdown: '# Draft\n', version: 3 })
    const kept = { ...storage.entries }
    const read = readWorkingCopy(storage, key)
    dropWorkingCopy(storage, key)

    expect(kept).toEqual({
      'hollware:working-copy:blog:ent_1': '{"markdown":"# Draft\\n","version":3}',
    })
    expect(read).toEqual({ markdown: '# Draft\n', version: 3 })
    expect(storage.entries).toEqual({})
  })

  it('reads nothing from a value it did not write, a storage that refuses, or none, and throws nothing', () => {
    const key = workingCopyKey('blog', 'ent_1')
    const broken = memory({
      [key]: '{"markdown":3,"version":"3"}',
      [workingCopyKey('blog', 'ent_2')]: 'not json',
      [workingCopyKey('blog', 'ent_3')]: '{"markdown":"x","version":3.5}',
    })

    expect([
      readWorkingCopy(broken, key),
      readWorkingCopy(broken, workingCopyKey('blog', 'ent_2')),
      readWorkingCopy(broken, workingCopyKey('blog', 'ent_3')),
      readWorkingCopy(throwing, key),
      readWorkingCopy(undefined, key),
    ]).toEqual([null, null, null, null, null])
    expect(() => keepWorkingCopy(throwing, key, { markdown: 'x', version: 1 })).not.toThrow()
    expect(() => dropWorkingCopy(throwing, key)).not.toThrow()
  })

  it('is restored when it is of the version the entry has, offered when older, and left out otherwise', () => {
    const entry = { version: 4, markdown: '# Saved\n' }

    expect([
      restoreOf(null, entry),
      restoreOf({ markdown: '# Saved\n', version: 4 }, entry),
      restoreOf({ markdown: '# Mine\n', version: 4 }, entry),
      restoreOf({ markdown: '# Mine\n', version: 2 }, entry),
      restoreOf({ markdown: '# Mine\n', version: 5 }, entry),
    ]).toEqual([
      { kind: 'none' },
      { kind: 'none' },
      { kind: 'same', markdown: '# Mine\n' },
      { kind: 'older', markdown: '# Mine\n', version: 2 },
      { kind: 'none' },
    ])
  })
})

describe('the save of a draft', () => {
  it('waits 8 s after a change, and never past a minute from the first change it has not saved', () => {
    expect([
      saveDelay(0, 0),
      saveDelay(0, 30_000),
      saveDelay(0, 55_000),
      saveDelay(0, 70_000),
    ]).toEqual([8_000, 8_000, 5_000, 0])
  })
})

describe('the copy the editor keeps after a change', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is kept 300 ms after the last change, with the version the entry has by then', () => {
    const storage = memory()
    const copies = copyKeeper(storage)
    let version = 3
    copies.keep('k', () => ({ markdown: 'One', version }))
    vi.advanceTimersByTime(100)
    copies.keep('k', () => ({ markdown: 'One two', version }))
    vi.advanceTimersByTime(299)
    const early = { ...storage.entries }
    version = 4
    vi.advanceTimersByTime(1)

    expect(early).toEqual({})
    expect(storage.entries).toEqual({ k: '{"markdown":"One two","version":4}' })
  })

  it('waits no more once dropped or cancelled, so a save that lands first leaves no copy behind', () => {
    const storage = memory({ k: '{"markdown":"Before","version":2}' })
    const copies = copyKeeper(storage)
    copies.keep('k', () => ({ markdown: 'Saved', version: 3 }))
    copies.drop('k')
    vi.advanceTimersByTime(1_000)
    const dropped = { ...storage.entries }
    copies.keep('k', () => ({ markdown: 'Typed back', version: 3 }))
    copies.cancel()
    vi.advanceTimersByTime(1_000)
    copies.keep('k', () => null)
    vi.advanceTimersByTime(1_000)

    expect(dropped).toEqual({})
    expect(storage.entries).toEqual({})
  })
})

describe('a copy the editor finds when the text is back to what is saved', () => {
  it('is older, and kept on offer, only when it was made for an earlier version', () => {
    expect([
      isOlderCopy({ markdown: 'Before', version: 2 }, 3),
      isOlderCopy({ markdown: 'Typed', version: 3 }, 3),
      isOlderCopy({ markdown: 'Later', version: 4 }, 3),
      isOlderCopy(null, 3),
    ]).toEqual([true, false, false, false])
  })
})
