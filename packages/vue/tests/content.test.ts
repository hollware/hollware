import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vite-plus/test'

import { HollwareContent, HollwareImage } from '../src/index.ts'

const document = {
  nodes: [
    ['h1', { id: 'hello' }, 'Hello'],
    ['callout', { type: 'tip' }, ['p', {}, 'Mind the ', ['strong', {}, 'contracts'], '.']],
  ],
  frontmatter: { title: 'Hello' },
  meta: {},
}

const Callout = defineComponent({
  props: { type: { type: String, default: undefined } },
  setup(props, { slots }) {
    return () => h('aside', { 'data-kind': props.type, class: 'my-callout' }, slots.default?.())
  },
})

function render(props: Record<string, unknown>) {
  return renderToString(createSSRApp({ render: () => h(HollwareContent, props) }))
}

describe('<HollwareContent>', () => {
  it('renders the document on the server, a component of the entry as the site maps it', async () => {
    const html = await render({ entry: { document }, components: { callout: Callout } })

    expect(html).toContain('<h1 id="hello">Hello</h1>')
    expect(html).toContain(
      '<aside data-kind="tip" class="my-callout"><p>Mind the <strong>contracts</strong>.</p></aside>',
    )
  })

  it('renders an element with no mapping as the plain tag', async () => {
    const html = await render({ entry: { document } })

    expect(html).toContain(
      '<callout type="tip"><p>Mind the <strong>contracts</strong>.</p></callout>',
    )
  })

  it('renders an image with its size and copies, as Hollware gives them to a site', async () => {
    const image = {
      nodes: [
        [
          'img',
          {
            src: 'https://cms.test/assets/blog/ast_a',
            alt: 'A diagram',
            srcset:
              'https://cms.test/assets/blog/ast_a/640 640w, https://cms.test/assets/blog/ast_a 1600w',
            sizes: '(min-width: 1600px) 1600px, 100vw',
            width: '1600',
            height: '900',
          },
        ],
      ],
      frontmatter: {},
      meta: {},
    }

    const html = await render({ entry: { document: image } })

    expect(html).toContain(
      'srcset="https://cms.test/assets/blog/ast_a/640 640w, https://cms.test/assets/blog/ast_a 1600w"',
    )
    expect(html).toContain('sizes="(min-width: 1600px) 1600px, 100vw"')
    expect(html).toContain('width="1600"')
    expect(html).toContain('height="900"')
  })

  it('renders nothing for an entry without a document', async () => {
    expect(await render({ entry: { frontmatter: {} } })).toBe('<!---->')
    expect(await render({ entry: null })).toBe('<!---->')
    expect(await render({ entry: { document: { nodes: 'x' } } })).toBe('<!---->')
  })
})

describe('<HollwareImage>', () => {
  const COVER = 'https://cms.test/assets/blog/ast_a'
  const post = {
    frontmatter: { img: COVER },
    images: {
      [COVER]: { width: 1600, height: 900, srcset: `${COVER}/640 640w`, alt: 'A diagram' },
    },
  }
  const image = (props: { entry: typeof post; field: string; loading?: string; alt?: string }) =>
    renderToString(createSSRApp({ render: () => h(HollwareImage, props) }))

  it('renders the image of a frontmatter field with its alt, size and copies; an attribute given wins', async () => {
    expect(await image({ entry: post, field: 'img', loading: 'lazy' })).toBe(
      `<img src="${COVER}" alt="A diagram" srcset="${COVER}/640 640w" sizes="(min-width: 1600px) 1600px, 100vw" width="1600" height="900" loading="lazy">`,
    )
    expect(await image({ entry: post, field: 'img', alt: 'Mine' })).toContain('alt="Mine"')
    expect(await image({ entry: post, field: 'none' })).toBe('<!---->')
  })
})
