import { describe, expect, it } from 'vite-plus/test'
import { renderToString } from 'react-dom/server'

import { HollwareContent } from '../src/index.ts'

// Fails when: <HollwareContent> stops rendering the nodes of the entry's Comark document, stops
// handing a component of the entry to the site's own mapping of that name (`Callout`, as the
// entry's `::callout`) with its props and its children, renders something for an entry that has
// no document, or drops the class the site gives the wrapper.

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

  it('renders nothing for an entry with no document, or no entry', () => {
    expect([
      renderToString(<HollwareContent entry={undefined} />),
      renderToString(<HollwareContent entry={null} />),
      renderToString(<HollwareContent entry={{}} />),
      renderToString(<HollwareContent entry={{ document: 'not a document' }} />),
    ]).toEqual(['', '', '', ''])
  })
})
