import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { parseForEditing, stringifyBody } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { componentContent } from '../app/lib/editor/components.ts'
import { fromEditor, toEditor } from '../app/lib/editor/convert.ts'
import { editedInline, isInlineComponent, wrapInline } from '../app/lib/editor/inline.ts'
import { editorExtensions } from '../app/lib/editor/nodes.ts'
import {
  addChild,
  componentAround,
  componentDragDeduction,
  deleteNode,
  duplicateNode,
  insertInside,
  moveNode,
  repeatedChild,
} from '../app/lib/editor/tree.ts'

const schema = getSchema(editorExtensions())

const CAPABILITIES =
  '::capabilities\nIntro\n\n  :::card{icon="a"}\n  One\n  :::\n\n  :::card{icon="b"}\n  Two\n  :::\n::\n'

async function opened(markdown: string): Promise<EditorState> {
  const { nodes } = await parseForEditing(markdown)
  return EditorState.create({ schema, doc: Node.fromJSON(schema, toEditor(nodes)) })
}

async function written(doc: Node): Promise<string> {
  const markdown = await stringifyBody({
    nodes: fromEditor(doc.toJSON()),
    frontmatter: {},
    meta: {},
  })
  const again = await stringifyBody(await parseForEditing(markdown))
  expect(again).toBe(markdown)
  return markdown
}

function positions(doc: Node, name: string): number[] {
  const found: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'comarkComponent' && node.attrs['name'] === name) found.push(pos)
  })
  return found
}

function textPos(doc: Node, text: string): number {
  let at = -1
  doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(text) === true) {
      at = pos + node.text.indexOf(text)
    }
  })
  return at
}

async function changed(
  markdown: string,
  change: (tr: Transaction, doc: Node) => boolean,
): Promise<string> {
  const state = await opened(markdown)
  const tr = state.tr
  expect(change(tr, state.doc)).toBe(true)
  return written(tr.doc)
}

async function cardContent(): Promise<JSONContent> {
  const { nodes } = await parseForEditing(':::card{icon="new"}\nNew one\n:::')
  return componentContent('card', nodes)
}

describe('the items of a component', () => {
  it('are named when the component holds components of a single name', async () => {
    expect(repeatedChild((await opened(CAPABILITIES)).doc.child(0))).toBe('card')
    const mixed = await opened('::faq\n  :::question\n  A\n  :::\n\n  :::note\n  B\n  :::\n::\n')
    expect(repeatedChild(mixed.doc.child(0))).toBeNull()
    expect(repeatedChild((await opened('::faq\nNothing\n::\n')).doc.child(0))).toBeNull()
  })

  it('gain one more after the last of them, built from its example', async () => {
    const card = await cardContent()
    expect(
      await changed(CAPABILITIES, (tr, doc) =>
        addChild(tr, positions(doc, 'capabilities')[0]!, card),
      ),
    ).toBe(
      '::capabilities\nIntro\n\n  :::card{icon="a"}\n  One\n  :::\n\n  :::card{icon="b"}\n  Two\n  :::\n\n  :::card{icon="new"}\n  New one\n  :::\n::\n',
    )
  })

  it('gain none of a name they do not hold yet', async () => {
    const state = await opened(CAPABILITIES)
    const question = componentContent('question', [])
    expect(addChild(state.tr, positions(state.doc, 'capabilities')[0]!, question)).toBe(false)
  })

  it('take a component inside, in place of an empty paragraph or after what is there', async () => {
    const empty = componentContent('question', [])
    expect(
      await changed('::faq\n::\n', (tr, doc) => insertInside(tr, positions(doc, 'faq')[0]!, empty)),
    ).toBe('::faq\n  :::question\n  :::\n::\n')
    expect(
      await changed('::faq\nWhy?\n::\n', (tr, doc) =>
        insertInside(tr, positions(doc, 'faq')[0]!, empty),
      ),
    ).toBe('::faq\nWhy?\n\n  :::question\n  :::\n::\n')
  })

  it('take the place of the empty paragraph a new component starts with', async () => {
    const state = await opened('Before\n')
    const tr = state.tr.insert(
      state.doc.content.size,
      Node.fromJSON(schema, componentContent('faq', [])),
    )
    insertInside(tr, positions(tr.doc, 'faq')[0]!, componentContent('question', []))
    expect(tr.doc.child(1).toJSON()).toEqual({
      type: 'comarkComponent',
      attrs: { name: 'faq', props: null },
      content: [
        {
          type: 'comarkComponent',
          attrs: { name: 'question', props: null },
          content: [{ type: 'paragraph', attrs: { props: null } }],
        },
      ],
    })
  })

  it('nest as deep as needed, each level one more colon', async () => {
    const card = await cardContent()
    expect(
      await changed(CAPABILITIES, (tr, doc) => insertInside(tr, positions(doc, 'card')[1]!, card)),
    ).toBe(
      '::capabilities\nIntro\n\n  :::card{icon="a"}\n  One\n  :::\n\n  :::card{icon="b"}\n  Two\n\n    ::::card{icon="new"}\n    New one\n    ::::\n  :::\n::\n',
    )
  })

  it('move among their siblings, and not past the first or the last', async () => {
    expect(
      await changed(CAPABILITIES, (tr, doc) => moveNode(tr, positions(doc, 'card')[0]!, 1)),
    ).toBe(
      '::capabilities\nIntro\n\n  :::card{icon="b"}\n  Two\n  :::\n\n  :::card{icon="a"}\n  One\n  :::\n::\n',
    )
    expect(
      await changed(CAPABILITIES, (tr, doc) => moveNode(tr, positions(doc, 'card')[1]!, -1)),
    ).toBe(
      '::capabilities\nIntro\n\n  :::card{icon="b"}\n  Two\n  :::\n\n  :::card{icon="a"}\n  One\n  :::\n::\n',
    )
    const state = await opened(CAPABILITIES)
    expect(moveNode(state.tr, positions(state.doc, 'card')[1]!, 1)).toBe(false)
    expect(moveNode(state.tr, positions(state.doc, 'capabilities')[0]!, -1)).toBe(false)
  })

  it('keep the cursor in the item that moves', async () => {
    const state = await opened(CAPABILITIES)
    const tr = state.tr.setSelection(TextSelection.create(state.doc, textPos(state.doc, 'One') + 1))
    moveNode(tr, componentAround(tr.selection.$from)!, 1)
    expect(tr.selection.$from.parent.textContent).toBe('One')
    expect(tr.selection.$from.parentOffset).toBe(1)
  })

  it('are found around the cursor, the innermost first', async () => {
    const state = await opened(CAPABILITIES)
    const $two = state.doc.resolve(textPos(state.doc, 'Two'))
    expect(componentAround($two)).toBe(positions(state.doc, 'card')[1])
    expect(componentAround(state.doc.resolve(textPos(state.doc, 'Intro')))).toBe(0)
    expect(componentAround((await opened('Plain\n')).doc.resolve(1))).toBeNull()
  })

  it('are duplicated and deleted one at a time', async () => {
    expect(
      await changed(CAPABILITIES, (tr, doc) => duplicateNode(tr, positions(doc, 'card')[0]!)),
    ).toBe(
      '::capabilities\nIntro\n\n  :::card{icon="a"}\n  One\n  :::\n\n  :::card{icon="a"}\n  One\n  :::\n\n  :::card{icon="b"}\n  Two\n  :::\n::\n',
    )
    expect(
      await changed(CAPABILITIES, (tr, doc) => deleteNode(tr, positions(doc, 'card')[0]!)),
    ).toBe('::capabilities\nIntro\n\n  :::card{icon="b"}\n  Two\n  :::\n::\n')
  })

  it('are what the drag handle takes inside a component, not the blocks they hold', () => {
    const named = (name: string) => ({ type: { name } })
    expect(componentDragDeduction({ node: named('paragraph'), depth: 1 })).toBe(0)
    expect(componentDragDeduction({ node: named('comarkComponent'), depth: 2 })).toBe(0)
    expect(componentDragDeduction({ node: named('paragraph'), depth: 2 })).toBe(1000)
  })
})

describe('an inline component', () => {
  it('is any inline element but raw HTML, which stays as written', async () => {
    const { nodes } = await parseForEditing('A :mark[b]{tone="x"} and <span>c</span>\n')
    const [paragraph] = nodes
    expect(
      Array.isArray(paragraph) ? paragraph.slice(2).map((node) => isInlineComponent(node)) : [],
    ).toEqual([false, true, false, false])
  })

  it('wraps the selected words, their marks kept inside it', async () => {
    expect(
      await changed('Hello **Sky**ward today\n', (tr, doc) => {
        const from = textPos(doc, 'Sky')
        return wrapInline(tr, from, from + 'Skyward'.length, 'mark')
      }),
    ).toBe('Hello :mark[**Sky**ward] today\n')
  })

  it('wraps nothing when no words are selected or the block takes no components', async () => {
    const plain = await opened('Hello\n')
    expect(wrapInline(plain.tr, 1, 1, 'mark')).toBe(false)
    const code = await opened('```\nx = 1\n```\n')
    expect(wrapInline(code.tr, 1, 2, 'mark')).toBe(false)
  })

  it('takes new text and props, and keeps its marked text while the text is unchanged', async () => {
    const edit = (text: string, props: Record<string, unknown> | null) =>
      changed('A :mark[**b** c]{tone="x"} d\n', (tr, doc) => {
        let at = -1
        doc.descendants((node, pos) => {
          if (node.type.name === 'comarkInline') at = pos
        })
        const node: unknown = doc.nodeAt(at)?.attrs['node']
        if (!isInlineComponent(node)) return false
        tr.setNodeMarkup(at, undefined, { node: editedInline(node, text, props) })
        return true
      })
    expect(await edit('b c', { tone: 'serif' })).toBe('A :mark[**b** c]{tone="serif"} d\n')
    expect(await edit('Hyperion', { tone: 'x', ':size': '2' })).toBe(
      'A :mark[Hyperion]{tone="x" :size="2"} d\n',
    )
  })
})
