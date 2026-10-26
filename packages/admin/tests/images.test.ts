import { describe, expect, it } from 'vite-plus/test'

import { needsAssets } from '../app/lib/images.ts'

const red = 'asset:ast_0123456789abcdef0123456789'
const blue = 'asset:ast_fedcba9876543210fedcba9876'

describe('when the editor reads the library to show the images of an entry', () => {
  it('reads it for a reference it has no address of', () => {
    expect(needsAssets(`![a](${red})`, new Map())).toBe(true)
    expect(needsAssets(`![a](${red})\n\n![b](${blue})`, new Map([[red, '/assets/s/red']]))).toBe(
      true,
    )
  })

  it('leaves it alone when it knows every reference, or the body names none', () => {
    expect(needsAssets(`![a](${red})`, new Map([[red, '/assets/s/red']]))).toBe(false)
    expect(needsAssets('![a](https://example.com/a.png) asset:', new Map())).toBe(false)
  })
})
