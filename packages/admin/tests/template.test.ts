import { expect, it } from 'vite-plus/test'

import { newEntryMarkdown } from '../app/lib/template.ts'

// Fails when: a new entry stops starting from a frontmatter with every field its collection
// requires (app/lib/template.ts): the title first and quoted, the translation group set to the
// slug, a date field to today, an array empty, any other string empty, and nothing that is not
// required.

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
