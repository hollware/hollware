import { expect, it } from 'vite-plus/test'

import { parseSession } from '../app/utils/session.ts'

it('reads one event a line, by its mark, and a line with no mark as an answer', () => {
  expect(
    parseSession(
      [
        '> create_draft blog/en/a',
        '< saved, version 1',
        '',
        '! /frontmatter/title: missing',
        '? Set the title.',
        '@ Ana approves',
        '✓ published',
        '  plain text  ',
      ].join('\n'),
    ),
  ).toEqual([
    { kind: 'call', text: 'create_draft blog/en/a' },
    { kind: 'out', text: 'saved, version 1' },
    { kind: 'err', text: '/frontmatter/title: missing' },
    { kind: 'fix', text: 'Set the title.' },
    { kind: 'person', text: 'Ana approves' },
    { kind: 'ok', text: 'published' },
    { kind: 'out', text: 'plain text' },
  ])
})
