import { describe, expect, it } from 'vite-plus/test'

import { asksForMajor, majorsSince, promisedTag } from './api-check.ts'

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

describe('a break of the public API carried by a major version', () => {
  const major = "---\n'@hollware/server': major\n'@hollware/nuxt': major\n---\n\nThe beacon goes.\n"
  const minor = "---\n'@hollware/admin': minor\n---\n\nA new section.\n"

  it('reads the bump of each package in the front matter, and only there', () => {
    expect(asksForMajor(major)).toBe(true)
    expect(asksForMajor('---\n"hollware": major\n---\n')).toBe(true)
    expect(asksForMajor(minor)).toBe(false)
    expect(asksForMajor("---\n'@hollware/core': patch\n---\n\nNot a major version: major\n")).toBe(
      false,
    )
  })

  it('counts a major changeset made since the release, pending or moved to pre/ by a version commit', () => {
    const changesets = [
      { name: 'beacon.md', text: major },
      { name: 'admin.md', text: minor },
      { name: 'old-major.md', text: major },
    ]
    expect(majorsSince(changesets, new Set(['old-major.md']))).toEqual(['beacon.md'])
    expect(majorsSince(changesets, new Set(['beacon.md', 'old-major.md']))).toEqual([])
  })
})
