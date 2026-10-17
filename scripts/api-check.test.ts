import { describe, expect, it } from 'vite-plus/test'

import { promisedTag } from './api-check.ts'

// Fails when: promisedTag (scripts/api-check.ts) stops picking the newest release of
// @hollware/core from 1.0.0-rc.0 on (ADR-036), counting a 0.x release, ordering candidates by
// text instead of number, or ranking a candidate above the release of its version.

describe('the release that holds the promise of the public API', () => {
  it('is none before 1.0.0-rc.0, whatever 0.x says', () => {
    expect(promisedTag(['@hollware/core@0.10.0', '@hollware/core@0.11.0', 'hollware@1.0.0'])).toBe(
      null,
    )
  })

  it('is the newest candidate, by number, before 1.0.0', () => {
    expect(
      promisedTag([
        '@hollware/core@0.11.0',
        '@hollware/core@1.0.0-rc.2',
        '@hollware/core@1.0.0-rc.10',
        '@hollware/core@1.0.0-rc.9',
      ]),
    ).toBe('@hollware/core@1.0.0-rc.10')
  })

  it('is the release over its candidates, and the newest minor after it', () => {
    expect(promisedTag(['@hollware/core@1.0.0-rc.3', '@hollware/core@1.0.0'])).toBe(
      '@hollware/core@1.0.0',
    )
    expect(
      promisedTag(['@hollware/core@1.0.0', '@hollware/core@1.2.0', '@hollware/core@1.10.1']),
    ).toBe('@hollware/core@1.10.1')
  })
})
