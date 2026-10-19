import { describe, expect, it } from 'vite-plus/test'

import { imageOf } from '../src/index.ts'

// Fails when imageOf (src/hollware.ts) stops reading the URL of the frontmatter field, the alt,
// the size and the srcset of the image Hollware gives a site, gives a `sizes` that lets the image
// grow past its own width, answers something for a field that holds no URL, or invents a size or
// copies for an image Hollware knows nothing of.

const COVER = 'https://cms.test/assets/blog/ast_a'
const entry = {
  frontmatter: { img: COVER, other: 'https://elsewhere.test/a.png', title: 'Hello' },
  images: {
    [COVER]: {
      width: 1600,
      height: 900,
      srcset: `${COVER}/640 640w, ${COVER} 1600w`,
      alt: 'A diagram',
    },
  },
}

describe('imageOf', () => {
  it('gives the <img> of a frontmatter image: its alt, its size and its copies', () => {
    expect(imageOf(entry, 'img')).toEqual({
      src: COVER,
      alt: 'A diagram',
      srcset: `${COVER}/640 640w, ${COVER} 1600w`,
      sizes: '(min-width: 1600px) 1600px, 100vw',
      width: 1600,
      height: 900,
    })
  })

  it('gives an image from elsewhere as its URL alone, and nothing for a field with none', () => {
    expect(imageOf(entry, 'other')).toEqual({ src: 'https://elsewhere.test/a.png' })
    expect([imageOf(entry, 'missing'), imageOf(null, 'img'), imageOf({}, 'img')]).toEqual([
      null,
      null,
      null,
    ])
  })
})
