import { describe, expect, it } from 'vite-plus/test'
import { upstreamUrl } from './registry.ts'

describe('the upstream of the e2e registry', () => {
  it('is npm for every path a package manager asks', () => {
    expect(upstreamUrl('/@hollware%2fcore').href).toBe(
      'https://registry.npmjs.org/@hollware%2fcore',
    )
    expect(upstreamUrl('/-/npm/v1/security/advisories/bulk').href).toBe(
      'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    )
  })

  it('is never another host, whatever the path says', () => {
    expect(
      ['//evil.example/x', '@evil.example/x', 'https://evil.example/x'].map(
        (path) => upstreamUrl(path).host,
      ),
    ).toEqual(['registry.npmjs.org', 'registry.npmjs.org', 'registry.npmjs.org'])
  })
})
