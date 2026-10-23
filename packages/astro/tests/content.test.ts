import { describe, expect, it } from 'vite-plus/test'

import { contentNodes, elementOf, imageOf } from '../src/index.ts'

const entry = {
  data: { img: 'https://cms.test/assets/blog/ast_a' },
  rendered: {
    metadata: {
      document: {
        nodes: [
          ['p', { onclick: 'steal()' }, 'Hello'],
          ['a', { href: 'javascript:alert(1)' }, 'link'],
          ['script', {}, 'alert(1)'],
          ['img', { src: 'https://cms.test/a.png', alt: 'A' }],
        ],
      },
      images: {
        'https://cms.test/assets/blog/ast_a': {
          width: 800,
          height: 600,
          srcset: 'https://cms.test/assets/blog/ast_a/640 640w',
          alt: 'A cover',
        },
      },
    },
  },
}

describe('the content of an entry, for HollwareContent.astro', () => {
  it('goes through the rules of the HTML Hollware makes', () => {
    const nodes = contentNodes(entry)
    const elements = nodes.map((node) => (typeof node === 'string' ? node : elementOf(node)))

    expect(
      elements.map((element) =>
        element === null || typeof element === 'string' ? element : [element.tag, element.props],
      ),
    ).toEqual([['p', {}], ['a', {}], null, ['img', { src: 'https://cms.test/a.png', alt: 'A' }]])
    expect(contentNodes({})).toEqual([])
  })

  it("hands a component of the entry to the site's own, with its props, and keeps plain tags plain", () => {
    const Callout = () => null
    const callout = elementOf(['callout', { type: 'tip', ':items': '[1,2]' }, 'Hi'], { Callout })
    const plain = elementOf(['note', { type: 'x', ':data': '{"a":1}' }, 'Hi'])
    const image = elementOf(['img', { src: '/a.png' }])

    expect(callout).toEqual({
      tag: Callout,
      component: true,
      props: { type: 'tip', items: [1, 2] },
      children: ['Hi'],
      empty: false,
    })
    expect(plain?.props).toEqual({ type: 'x' })
    expect([plain?.component, image?.empty]).toEqual([false, true])
  })
})

describe('the image of the frontmatter, for HollwareImage.astro', () => {
  it('reads its size and copies from what the loader kept', () => {
    expect(imageOf(entry, 'img')).toEqual({
      src: 'https://cms.test/assets/blog/ast_a',
      alt: 'A cover',
      srcset: 'https://cms.test/assets/blog/ast_a/640 640w',
      sizes: '(min-width: 800px) 800px, 100vw',
      width: 800,
      height: 600,
    })
    expect(imageOf(entry, 'none')).toBe(null)
  })
})
