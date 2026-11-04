import { describe, expect, it } from 'vite-plus/test'

import { releaseNotesUrl } from '../app/lib/release.ts'

describe('the notes of a release', () => {
  it('are its GitHub release, tagged hollware@ and the version', () => {
    expect(releaseNotesUrl('1.8.0-rc.1')).toBe(
      'https://github.com/hollware/hollware/releases/tag/hollware%401.8.0-rc.1',
    )
  })
})
