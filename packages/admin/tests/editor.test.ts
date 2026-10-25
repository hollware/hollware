import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { parseForEditing, stringifyBody } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import { CONTENT_FIXTURES } from '../../../tests/fixtures/content.ts'
import { editsLosslessly, fromEditor, toEditor } from '../app/lib/editor/convert.ts'
import { editorExtensions } from '../app/lib/editor/nodes.ts'

const schema = getSchema(editorExtensions())

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

function bodyOf(markdown: string): string {
  const mark = String.fromCodePoint(0xfeff)
  return (markdown.startsWith(mark) ? markdown.slice(1) : markdown).replace(FRONTMATTER, '')
}

async function throughEditor(
  body: string,
  edit: (doc: JSONContent) => JSONContent = (doc) => doc,
): Promise<string> {
  const document = await parseForEditing(body)
  const json: JSONContent = Node.fromJSON(schema, toEditor(document.nodes)).toJSON()
  const edited: JSONContent = Node.fromJSON(schema, edit(json)).toJSON()
  return stringifyBody({ ...document, nodes: fromEditor(edited) })
}

const COMARK_CASES: readonly string[] = [
  '::card{title="A"}\nOuter\n\n:::note\nInner **b**\n:::\n\n#footer\nFoot\n::\n',
  'A [link](/x){target="_blank"} and **b**{.big} and :badge[New]{color="red"}\n',
  '> [!WARNING]\n> Careful *now*.\n',
  '> Careful [sic] *now*.\n',
  '> A quote\n>\n> in two paragraphs\n',
  '- [ ] one\n- [x] two **bold**\n',
  '| a | b |\n|:--|--:|\n| 1 | 2 |\n',
  'Text <span class="x">raw</span>\n\n<div>\nblock\n</div>\n\n<!-- a comment -->\n',
  '````md\n```js\nx\n```\n````\n',
  '```ts [file.ts] {1}\nconst a = 1\n```\n',
  'line one  \nline two\\\nthree\n',
  '![alt](asset:ast_123 "Title") ![](https://x.example/a.png)\n',
  '- a\n  - b\n    1. c\n- d\n',
  '3. three\n4. four\n',
  '# Title {#custom}\n\n---\n\nSome *em*, **strong**, ~~gone~~, `code` and ***both***.\n',
  '_a **b**_ and **a _b_ c**\n',
  '::callout{type="info" :count="5"}\nHi\n::\n',
  '::youtube{id="x"}\n::\n',
]

describe('the editor', () => {
  it('writes back every file it opens as Comark writes it, so opening and saving changes no byte', async () => {
    for (const source of [
      ...CONTENT_FIXTURES.map(({ markdown }) => bodyOf(markdown)),
      ...COMARK_CASES,
    ]) {
      const body = await stringifyBody(await parseForEditing(source))
      expect(await throughEditor(body), source).toBe(body)
    }
  })

  it('writes an edit as the canonical Markdown of what changed', async () => {
    const ticked = await throughEditor('- [ ] one\n- [ ] two\n', (doc) => {
      const list = doc.content?.[0]
      const first = list?.content?.[0]
      if (first?.attrs !== undefined) first.attrs['checked'] = true
      return doc
    })
    expect(ticked).toBe('- [x] one\n- [ ] two\n')

    const bolded = await throughEditor('Plain words.\n', () => ({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain ' },
            { type: 'text', text: 'words', marks: [{ type: 'bold' }] },
            { type: 'text', text: '.' },
          ],
        },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] },
        { type: 'paragraph' },
      ],
    }))
    expect(bolded).toBe('Plain **words**.\n\n## Next\n')
  })
})

describe('an entry the editor cannot keep byte for byte', () => {
  async function lossless(body: string): Promise<boolean> {
    const document = await parseForEditing(body)
    const opened: JSONContent = Node.fromJSON(schema, toEditor(document.nodes)).toJSON()
    return editsLosslessly(document.nodes, opened, (nodes) => stringifyBody({ ...document, nodes }))
  }

  it('is told apart from one it keeps, so it opens as Markdown', async () => {
    expect(await lossless('Some **text**, [sic] and a [link](/x).\n')).toBe(true)
    expect(await lossless('<!-- c -->/en/blog/x/}/blog/y/[x][r]\r<- [ ] \t')).toBe(false)
  })
})
