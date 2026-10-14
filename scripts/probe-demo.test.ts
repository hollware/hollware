import { describe, expect, it } from 'vite-plus/test'

import { verdict } from './probe-demo.ts'

// Fails when: scripts/probe-demo.ts stops failing a series in which one run took 60 seconds or
// more, or never went live, or an empty series, or stops passing one in which every run was live
// in under 60 seconds.

describe('the verdict of the probe', () => {
  it('passes when every run was live in under 60 seconds', () => {
    expect(verdict([1200, 59_999])).toEqual({
      ok: true,
      lines: [
        'run 1: live in 1.2 s',
        'run 2: live in 60.0 s',
        'OK: every run was live in under 60 s',
      ],
    })
  })

  it.each([
    ['a run of 60 seconds', [1200, 60_000]],
    ['a run that never went live', [1200, null]],
    ['no run at all', []],
  ])('fails %s', (_name, times) => {
    expect(verdict(times).ok).toBe(false)
  })
})
