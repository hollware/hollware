import { describe, expect, it } from 'vite-plus/test'
import { checkAdrs } from '../guards/adr.ts'
import { describeViolations, type TextFile } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles, readText } from '../support/repo.ts'

// Fails when: an ADR file is misnamed or its number is reused or skipped; an ADR's title, status
// line or sections break docs/adr/README.md; or the index of docs/adr/README.md or the ADR table of
// docs/design.md stops listing exactly the ADR files with their number, title and status.

const BODY =
  '\n## Context\n\nWhy.\n\n## Decision\n\nWhat.\n\n## Consequences\n\nSo.\n\n## Alternatives considered\n\nNot.\n'

function adr(
  number: number,
  title: string,
  status = 'Accepted (2026-10-11)',
  body = BODY,
): TextFile {
  const id = String(number).padStart(3, '0')
  return file(
    `docs/adr/${id.padStart(4, '0')}-${title.toLowerCase().replaceAll(' ', '-')}.md`,
    `# ADR-${id}: ${title}\n\nStatus: ${status}\n${body}`,
  )
}

function readme(rows: string[]): TextFile {
  return file(
    'docs/adr/README.md',
    [
      '# Architecture decision records',
      '',
      '| ADR | Title | Status | Link |',
      '| --- | ----- | ------ | ---- |',
      ...rows,
      '',
      '## Template',
      '',
      '```markdown',
      '# ADR-NNN: Title',
      '',
      'Status: Proposed (YYYY-MM-DD)',
      '',
      '## Anything the template says',
      '```',
      '',
    ].join('\n'),
  )
}

const row = (number: string, title: string, status: string, target: string) =>
  `| ${number} | ${title} | ${status} | [${target}](${target}) |`

function design(rows: string[]): TextFile {
  return file(
    'docs/design.md',
    ['# Design', '', '| ADR | Title | Status |', '| --- | --- | --- |', ...rows, ''].join('\n'),
  )
}

const designRow = (number: string, target: string, title: string, status: string) =>
  `| [ADR-${number}](adr/${target}) | ${title} | ${status} |`

const ONE = adr(1, 'First decision')
const TWO = adr(2, 'Second decision', 'Proposed (2026-10-12)')
const GOOD_README = readme([
  row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
  row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
])
const GOOD_DESIGN = design([
  designRow('001', '0001-first-decision.md', 'First decision', 'Accepted'),
  designRow('002', '0002-second-decision.md', 'Second decision', 'Proposed'),
])

const check = (files: TextFile[], design: TextFile = GOOD_DESIGN) => checkAdrs({ files, design })

const describe1 = (violations: ReturnType<typeof checkAdrs>) =>
  violations.map((violation) => `${violation.rule}: ${violation.message}`)

/** The violations with the design document left out, to look at the ADRs and the index alone. */
const messages = (files: TextFile[]) => describe1(checkAdrs({ files }))

/** The violations with a design document. */
const messagesWith = (files: TextFile[], design: TextFile) => describe1(check(files, design))

describe('ADRs', () => {
  it('every ADR follows the template, and the index and the design table list them all', () => {
    const files = readRepoFiles((path) => /^docs\/adr\/[^/]+$/.test(path))
    expect(files).toHaveLength(29)
    const violations = checkAdrs({
      files,
      design: file('docs/design.md', readText('docs/design.md')),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the good fixture, whose README holds a template in a code fence', () => {
      expect(check([ONE, TWO, GOOD_README])).toEqual([])
    })

    it('accepts a superseded ADR that names an existing one', () => {
      const superseded = adr(1, 'First decision', 'Superseded by ADR-002 (2026-10-13)')
      const files = [
        superseded,
        TWO,
        readme([
          row('001', 'First decision', 'Superseded by ADR-002', '0001-first-decision.md'),
          row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
        ]),
      ]
      const table = design([
        designRow('001', '0001-first-decision.md', 'First decision', 'Superseded by ADR-002'),
        designRow('002', '0002-second-decision.md', 'Second decision', 'Proposed'),
      ])
      expect(check(files, table)).toEqual([])
    })

    it('reports a superseded ADR that points nowhere', () => {
      const dangling = adr(1, 'First decision', 'Superseded by ADR-009 (2026-10-13)')
      expect(messages([dangling, TWO, GOOD_README]).slice(0, 1)).toEqual([
        'adr/superseded-target: "Superseded by ADR-009" must name another ADR that exists',
      ])
    })

    it('reports files that are neither the README nor a well-named ADR', () => {
      const stray = [
        file('docs/adr/notes.md', '# notes'),
        file('docs/adr/15-foo.md', '#'),
        file('docs/adr/0003-Bad_Name.md', '#'),
      ]
      const result = check([ONE, TWO, GOOD_README, ...stray]).filter(
        (violation) => violation.rule === 'adr/file-name',
      )
      expect(result.map((violation) => violation.file)).toEqual([
        'docs/adr/notes.md',
        'docs/adr/15-foo.md',
        'docs/adr/0003-Bad_Name.md',
      ])
      expect(result[0]?.message).toBe(
        'a file in docs/adr/ is README.md or an ADR named NNNN-kebab-case-title.md (four digits, lowercase): anything else escapes the checks on ADRs',
      )
    })

    it('reports a number that is reused', () => {
      const twin = file('docs/adr/0001-another-decision.md', adr(1, 'Another decision').text)
      expect(messages([ONE, twin, GOOD_README]).slice(0, 1)).toEqual([
        'adr/number-gap: ADR numbers must run from 1 without gaps or repeats (an ADR is superseded, never deleted), found 001, 001',
      ])
    })

    it('reports a number that is skipped', () => {
      const three = adr(3, 'Third decision')
      expect(
        messages([
          ONE,
          three,
          readme([
            row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
            row('003', 'Third decision', 'Accepted', '0003-third-decision.md'),
          ]),
        ]),
      ).toEqual([
        'adr/number-gap: ADR numbers must run from 1 without gaps or repeats (an ADR is superseded, never deleted), found 001, 003',
      ])
    })

    it('reports a title whose number is not the file number, and a first line that is not a title', () => {
      const wrongNumber = file(ONE.path, ONE.text.replace('# ADR-001:', '# ADR-002:'))
      expect(messages([wrongNumber, TWO, GOOD_README])[0]).toBe(
        'adr/title: the first line must be "# ADR-001: <title>", found "# ADR-002: First decision"',
      )
      const noTitle = file(
        ONE.path,
        ONE.text.replace('# ADR-001: First decision', 'First decision'),
      )
      expect(messages([noTitle, TWO, GOOD_README])[0]).toBe(
        'adr/title: the first line must be "# ADR-001: <title>", found "First decision"',
      )
    })

    it('reports a malformed status line, an unknown status and an impossible date', () => {
      for (const status of [
        'accepted (2026-10-11)',
        'Accepted',
        'Accepted 2026-10-11',
        'Draft (2026-10-11)',
      ]) {
        const bad = adr(1, 'First decision', status)
        expect(messages([bad, TWO, GOOD_README])[0]).toContain(
          'adr/status: the first line after the title must be',
        )
      }
      const impossible = adr(1, 'First decision', 'Accepted (2026-13-45)')
      expect(messages([impossible, TWO, GOOD_README])[0]).toBe(
        'adr/status: the status date 2026-13-45 is not a real date',
      )
    })

    it('reports a missing section, an extra one, a different order and a sub-heading', () => {
      const without = adr(
        1,
        'First decision',
        undefined,
        BODY.replace('\n## Alternatives considered\n\nNot.\n', ''),
      )
      expect(messages([without, TWO, GOOD_README])[0]).toBe(
        'adr/sections: an ADR has exactly the sections "## Context", "## Decision", "## Consequences", "## Alternatives considered", in that order and no other heading, found "## Context", "## Decision", "## Consequences"',
      )
      const extra = adr(1, 'First decision', undefined, `${BODY}\n## Notes\n\nMore.\n`)
      const swapped = adr(
        1,
        'First decision',
        undefined,
        BODY.replace('## Context', '## Tmp')
          .replace('## Decision', '## Context')
          .replace('## Tmp', '## Decision'),
      )
      const sub = adr(1, 'First decision', undefined, BODY.replace('Why.', '### Detail\n\nWhy.'))
      for (const bad of [extra, swapped, sub]) {
        expect(messages([bad, TWO, GOOD_README]).map((message) => message.split(':')[0])).toEqual([
          'adr/sections',
        ])
      }
    })

    it('ignores headings inside code fences', () => {
      const fenced = adr(
        1,
        'First decision',
        undefined,
        BODY.replace('Why.', '```sh\n# a comment, not a heading\n## nor this\n```'),
      )
      expect(
        check([
          fenced,
          TWO,
          readme([
            row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
            row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
          ]),
        ]),
      ).toEqual([])
    })

    it('reports an ADR missing from the index, and an index row for a file that does not exist', () => {
      const short = readme([row('001', 'First decision', 'Accepted', '0001-first-decision.md')])
      expect(messages([ONE, TWO, short])).toEqual([
        'adr/index-missing: 0002-second-decision.md is not in the index: add a row for it in the same commit',
      ])
      const extra = readme([
        row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
        row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
        row('003', 'Third decision', 'Accepted', '0003-third-decision.md'),
      ])
      expect(messages([ONE, TWO, extra])).toEqual([
        'adr/index-extra: the index links to 0003-third-decision.md, which is not an ADR file of docs/adr/',
      ])
    })

    it('reports an index row whose number, title or status differs from the file', () => {
      for (const wrong of [
        row('001', 'First decision!', 'Accepted', '0001-first-decision.md'),
        row('001', 'First decision', 'Proposed', '0001-first-decision.md'),
        row('002', 'First decision', 'Accepted', '0001-first-decision.md'),
      ]) {
        const index = readme([
          wrong,
          row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
        ])
        expect(messages([ONE, TWO, index]).map((message) => message.split(':')[0])).toEqual([
          'adr/index-mismatch',
        ])
      }
      const index = readme([
        row('001', 'First decision', 'Proposed', '0001-first-decision.md'),
        row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
      ])
      expect(messages([ONE, TWO, index])).toEqual([
        'adr/index-mismatch: the index row for 0001-first-decision.md says "001 | First decision | Proposed" but the file says "001 | First decision | Accepted"',
      ])
    })

    it('reports a row listed twice', () => {
      const index = readme([
        row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
        row('001', 'First decision', 'Accepted', '0001-first-decision.md'),
        row('002', 'Second decision', 'Proposed', '0002-second-decision.md'),
      ])
      expect(messages([ONE, TWO, index])).toEqual([
        'adr/index-duplicate: 0001-first-decision.md is listed twice in the index',
      ])
    })

    it('does not read the template in the README as an index row', () => {
      const withFencedRow = file(
        'docs/adr/README.md',
        `${GOOD_README.text}\n\`\`\`\n| 009 | Ghost | Accepted | [0009-ghost.md](0009-ghost.md) |\n\`\`\`\n`,
      )
      expect(check([ONE, TWO, withFencedRow])).toEqual([])
    })

    it('reports a README that is missing', () => {
      expect(messages([ONE, TWO])).toEqual([
        'adr/index-missing: docs/adr/README.md is missing: it holds the index of the ADRs',
      ])
    })

    it('reports a design table that has drifted from the ADRs', () => {
      const stale = design([
        designRow('001', '0001-first-decision.md', 'First decision', 'Proposed'),
        designRow('003', '0003-third-decision.md', 'Third decision', 'Accepted'),
      ])
      expect(messagesWith([ONE, TWO, GOOD_README], stale)).toEqual([
        'adr/design-mismatch: the ADR table row for 0001-first-decision.md says "001 | First decision | Proposed" but the file says "001 | First decision | Accepted"',
        'adr/design-extra: the ADR table links to 0003-third-decision.md, which is not an ADR file of docs/adr/',
        'adr/design-missing: 0002-second-decision.md is not in the ADR table of the design document',
      ])
    })
  })
})
