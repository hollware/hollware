import { describe, expect, it } from 'vite-plus/test'

import { reportOf } from '../src/auditor.ts'
import { slugOf, unfenced } from '../src/translator.ts'

// Fails when: the translator (src/translator.ts) stops making a slug of lowercase ASCII words from
// a title, accents dropped, or stops taking a file out of the code fence a model may put around
// it; or the auditor's report (src/auditor.ts) stops carrying its frontmatter and both sections.

describe('slugOf', () => {
  it('makes lowercase ASCII words joined by hyphens, accents dropped', () => {
    expect(slugOf('Purgar la caché del borde: ¿cómo?')).toBe('purgar-la-cache-del-borde-como')
    expect(slugOf('¡¿?!')).toBe('translation')
  })
})

describe('unfenced', () => {
  it('takes the file out of a code fence, and leaves a bare one as it is', () => {
    expect(unfenced('```markdown\n---\ntitle: A\n---\nText.\n```')).toBe(
      '---\ntitle: A\n---\nText.\n',
    )
    expect(unfenced('---\ntitle: A\n---\nText.')).toBe('---\ntitle: A\n---\nText.\n')
  })
})

describe('reportOf', () => {
  it('writes the frontmatter and both sections, with Nothing where nothing was found', () => {
    expect(
      reportOf(
        '2026-10-19',
        [{ kind: 'contract', where: 'blog/en/a', what: 'warning internal-links: gone' }],
        { collection: 'reports', locale: 'en' },
      ),
    ).toBe(
      [
        '---',
        'title: "Content audit of 2026-10-19"',
        'description: "What the weekly audit of 2026-10-19 found: read but old, and failing contracts."',
        '---',
        '',
        '# Content audit of 2026-10-19',
        '',
        '## Read a lot, updated long ago',
        '',
        'Nothing.',
        '',
        '## Published, and failing the contracts now',
        '',
        '- blog/en/a: warning internal-links: gone',
        '',
      ].join('\n'),
    )
  })
})
