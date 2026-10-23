import { expect, it } from 'vite-plus/test'

import { newEntryMarkdown } from '../app/lib/template.ts'

it('writes every required field, with a value its schema can take', () => {
  const schema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      date: { type: 'string', format: 'date' },
      tags: { type: 'array', items: { type: 'string' } },
      translationGroup: { type: 'string' },
      draftNote: { type: 'string' },
    },
    required: ['date', 'description', 'tags', 'title', 'translationGroup'],
  }

  expect(
    newEntryMarkdown(schema, {
      title: 'Caching: a "guide"',
      slug: 'caching-guide',
      today: '2026-10-15',
      translationGroupField: 'translationGroup',
    }),
  ).toBe(
    '---\ntitle: "Caching: a \\"guide\\""\ndate: 2026-10-15\ndescription: ""\ntags: []\ntranslationGroup: caching-guide\n---\n\n',
  )
})

it('names the group of the entry a translation translates', () => {
  const schema = {
    type: 'object',
    properties: { title: { type: 'string' }, group: { type: 'string' } },
    required: ['title'],
  }

  expect(
    newEntryMarkdown(schema, {
      title: 'Hola',
      slug: 'hola',
      today: '2026-10-16',
      translationGroupField: 'group',
      translationGroup: 'hello',
    }),
  ).toBe('---\ntitle: "Hola"\ngroup: "hello"\n---\n\n')
})
