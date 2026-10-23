import { describe, expect, it } from 'vite-plus/test'
import { renderToString } from 'react-dom/server'

import { HollwareContent, HollwareImage } from '../src/index.ts'

const document = {
  nodes: [
    ['h1', { id: 'hello' }, 'Hello'],
    ['callout', { type: 'tip' }, ['p', {}, 'Mind the ', ['strong', {}, 'contracts'], '.']],
  ],
  frontmatter: { title: 'Hello' },
  meta: {},
}

function Callout(props: { type?: string; children?: React.ReactNode }) {
  return (
    <aside data-kind={props.type} className="my-callout">
      {props.children}
    </aside>
  )
}

describe('<HollwareContent>', () => {
  it('renders the document on the server, a component of the entry as the site maps it', () => {
    const html = renderToString(
      <HollwareContent entry={{ document }} components={{ Callout }} className="post" />,
    )

    expect(html).toBe(
      '<div class="comark-content post"><h1 id="hello">Hello</h1>' +
        '<aside data-kind="tip" class="my-callout"><p>Mind the <strong>contracts</strong>.</p></aside></div>',
    )
  })

  it('renders a component nobody mapped as the plain tag, children kept', () => {
    const html = renderToString(<HollwareContent entry={{ document }} />)

    expect(html).toBe(
      '<div class="comark-content "><h1 id="hello">Hello</h1>' +
        '<callout type="tip"><p>Mind the <strong>contracts</strong>.</p></callout></div>',
    )
  })

  it('renders an image with its size and copies, as Hollware gives them to a site', () => {
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

    const html = renderToString(<HollwareContent entry={{ document: image }} />)

    expect(html).toContain(
      'srcset="https://cms.test/assets/blog/ast_a/640 640w, https://cms.test/assets/blog/ast_a 1600w"',
    )
    expect(html).toContain('sizes="(min-width: 1600px) 1600px, 100vw"')
    expect(html).toContain('width="1600"')
    expect(html).toContain('height="900"')
  })

  it('renders nothing for an entry with no document, or no entry', () => {
    expect([
      renderToString(<HollwareContent entry={undefined} />),
      renderToString(<HollwareContent entry={null} />),
      renderToString(<HollwareContent entry={{}} />),
      renderToString(<HollwareContent entry={{ document: 'not a document' }} />),
    ]).toEqual(['', '', '', ''])
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

  it('renders the image of a frontmatter field with its alt, size and copies; a prop given wins', () => {
    expect(renderToString(<HollwareImage entry={post} field="img" loading="lazy" />)).toBe(
      `<img src="${COVER}" alt="A diagram" srcSet="${COVER}/640 640w" sizes="(min-width: 1600px) 1600px, 100vw" width="1600" height="900" loading="lazy"/>`,
    )
    expect(renderToString(<HollwareImage entry={post} field="img" alt="" />)).toContain('alt=""')
    expect(renderToString(<HollwareImage entry={post} field="none" />)).toBe('')
  })
})
