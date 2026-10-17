import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vite-plus/test'

import { HollwareContent } from '../src/index.ts'

// Fails when: <HollwareContent> stops rendering the nodes of the entry's Comark document, stops
// handing a component of the entry to the site's own mapping of that name (`callout`, as the
// entry's `::callout`) with its props and its children, renders something for an entry that has
// no document, or stops rendering the document when it is the only thing the entry has.

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

  it('renders nothing for an entry without a document', async () => {
    expect(await render({ entry: { frontmatter: {} } })).toBe('<!---->')
    expect(await render({ entry: null })).toBe('<!---->')
    expect(await render({ entry: { document: { nodes: 'x' } } })).toBe('<!---->')
  })
})
