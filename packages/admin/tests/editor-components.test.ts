import { getSchema, type JSONContent } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { parseForEditing, stringifyBody } from '@hollware/core'
import { describe, expect, it } from 'vite-plus/test'

import {
  matchingComponents,
  propForm,
  propProblems,
  writeProps,
  type PropValue,
} from '../app/lib/editor/components.ts'
import { fromEditor, toEditor } from '../app/lib/editor/convert.ts'
import { editorExtensions } from '../app/lib/editor/nodes.ts'

const schema = getSchema(editorExtensions())

const HERO = {
  type: 'object',
  required: ['visual'],
  properties: {
    visual: { type: 'string', enum: ['heatmap', 'graph'], description: 'What it draws' },
    background: { type: 'string', enum: ['cream', 'dark'], default: 'cream' },
    columns: { type: 'integer', default: 3 },
    framed: { type: 'boolean', default: false },
    image: { type: 'string', pattern: '^asset:ast_[a-z0-9]+$' },
    summary: { type: 'string', maxLength: 200 },
    id: { type: 'string', pattern: '^[a-z]+$', maxLength: 8 },
    tags: { type: 'array', items: { type: 'string' } },
  },
}

async function editProps(
  markdown: string,
  componentSchema: unknown,
  change: (values: Record<string, PropValue>) => Record<string, PropValue>,
): Promise<string> {
  const document = await parseForEditing(markdown)
  const doc: JSONContent = Node.fromJSON(schema, toEditor(document.nodes)).toJSON()
  const block = doc.content?.[0]
  if (block?.attrs === undefined) throw new Error('no component')
  const form = propForm(block.attrs['props'], componentSchema)
  block.attrs['props'] = writeProps(block.attrs['props'], form, change({ ...form.values }))
  return stringifyBody({ ...document, nodes: fromEditor(Node.fromJSON(schema, doc).toJSON()) })
}

describe('the props form of a component', () => {
  it('gives each prop the widget its schema asks for, with the default as placeholder', () => {
    const { fields } = propForm(null, HERO)
    expect(fields.map((field) => [field.name, field.kind, field.key, field.placeholder])).toEqual([
      ['visual', 'choice', 'visual', null],
      ['background', 'choice', 'background', 'cream'],
      ['columns', 'number', ':columns', '3'],
      ['framed', 'switch', ':framed', 'false'],
      ['image', 'image', 'image', null],
      ['summary', 'long', 'summary', null],
      ['id', 'text', 'id', null],
    ])
    expect(fields[0]).toMatchObject({ required: true, options: ['heatmap', 'graph'] })
  })

  it('reads typed bindings as numbers and booleans, and keeps what it cannot type as text', () => {
    const form = propForm(
      {
        visual: 'cube',
        ':columns': '4',
        ':framed': 'true',
        tone: 'serif',
        ':id': 'abc',
        ':tags': '["a"]',
      },
      HERO,
    )
    expect(form.values).toEqual({
      columns: 4,
      framed: true,
      id: 'abc',
      visual: 'cube',
      tone: 'serif',
      tags: '["a"]',
      background: null,
      image: null,
      summary: null,
    })
    expect(form.fields.filter((field) => field.kind === 'other').map((field) => field.key)).toEqual(
      ['visual', 'tone', ':tags'],
    )
    expect(
      propForm({ ':columns': 'auto', ':framed': 'maybe' }, HERO).fields.map((field) => [
        field.key,
        field.kind,
      ]),
    ).toEqual([
      ['visual', 'choice'],
      ['background', 'choice'],
      ['image', 'image'],
      ['summary', 'long'],
      ['id', 'text'],
      [':columns', 'other'],
      [':framed', 'other'],
    ])
  })

  it('refuses a form without a required value, over its length or off its pattern', () => {
    const { fields } = propForm(null, HERO)
    expect(propProblems(fields, { visual: null, id: 'abcdefghi', image: 'https://x' })).toEqual({
      visual: 'required',
      id: 'tooLong',
      image: 'pattern',
    })
    expect(propProblems(fields, { visual: 'graph', id: 'abc', image: 'asset:ast_1' })).toEqual({})
  })
})

describe('the props a component is written with', () => {
  it('keeps the props of a component nobody changed byte for byte', async () => {
    expect(
      await editProps(
        '::hero{:columns="04" framed visual="cube"}\nHi\n::\n',
        HERO,
        (values) => values,
      ),
    ).toBe('::hero{:columns="04" framed visual="cube"}\nHi\n::\n')
  })

  it('writes numbers and booleans as bound props and strings as plain ones', async () => {
    expect(
      await editProps('::hero{visual="graph" extra="x"}\nHi\n::\n', HERO, (values) => ({
        ...values,
        visual: 'heatmap',
        columns: 2,
      })),
    ).toBe('::hero{visual="heatmap" extra="x" :columns="2"}\nHi\n::\n')
    expect(
      await editProps('::hero{visual="graph"}\nHi\n::\n', HERO, (values) => ({
        ...values,
        framed: false,
        background: 'dark',
      })),
    ).toBe('::hero{visual="graph" background="dark" :framed="false"}\nHi\n::\n')
    expect(
      await editProps('::hero{visual="graph"}\nHi\n::\n', HERO, (values) => ({
        ...values,
        framed: true,
      })),
    ).toBe('::hero{visual="graph" framed}\nHi\n::\n')
  })

  it('drops a prop that is cleared, and keeps an unknown one under the name it had', async () => {
    expect(
      await editProps('::hero{visual="graph" id="ab" :weight="2"}\nHi\n::\n', HERO, (values) => ({
        ...values,
        visual: null,
        id: '',
        weight: '3',
      })),
    ).toBe('::hero{:weight="3"}\nHi\n::\n')
  })
})

describe('the components a search finds', () => {
  const definitions = [
    { name: 'hero', description: 'La sección de apertura', example: null, props: null },
    { name: 'card', description: 'Una tarjeta con ícono', example: null, props: null },
    { name: 'faq', description: null, example: null, props: null },
  ]

  it('matches every word in the name or the description, ignoring case and accents', () => {
    expect(matchingComponents(definitions, 'SECCION apertura').map(({ name }) => name)).toEqual([
      'hero',
    ])
    expect(matchingComponents(definitions, 'icono').map(({ name }) => name)).toEqual(['card'])
    expect(matchingComponents(definitions, 'faq tarjeta')).toEqual([])
  })

  it('answers every component for an empty search', () => {
    expect(matchingComponents(definitions, '  ').map(({ name }) => name)).toEqual([
      'hero',
      'card',
      'faq',
    ])
  })
})
