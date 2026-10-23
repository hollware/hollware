import { describe, expect, it } from 'vite-plus/test'
import { checkAdvisoryUrl } from '../guards/advisory-url.ts'
import { ADVISORY_URL } from '../guards/project.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const PATHS = [
  'SECURITY.md',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
]

describe('advisory URL', () => {
  it('SECURITY.md, the issue chooser and the bug form send reporters to the same address', () => {
    const files = PATHS.map((path) => file(path, readText(path)))
    expect(ADVISORY_URL).toBe('https://github.com/hollware/hollware/security/advisories/new')
    expect(describeViolations(checkAdvisoryUrl({ files, expected: ADVISORY_URL }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const good = `Report at [the form](${ADVISORY_URL}).`
    const files = (...texts: string[]) => texts.map((text, index) => file(`f${index}.md`, text))

    it('accepts the same address everywhere', () => {
      expect(checkAdvisoryUrl({ files: files(good, good), expected: ADVISORY_URL })).toEqual([])
    })

    it('reports a file that does not hold the address', () => {
      expect(
        checkAdvisoryUrl({ files: files(good, 'Report it somewhere.'), expected: ADVISORY_URL }),
      ).toEqual([
        {
          rule: 'advisory-url/missing',
          file: 'f1.md',
          message: `the file must send reporters to ${ADVISORY_URL}`,
        },
      ])
    })

    it('reports an advisory address of another repository', () => {
      const other = 'https://github.com/someone/else/security/advisories/new'
      expect(
        checkAdvisoryUrl({ files: files(good, `${good}\n${other}`), expected: ADVISORY_URL }),
      ).toEqual([
        {
          rule: 'advisory-url/different',
          file: 'f1.md',
          message: `${other} is not the project's advisory address ${ADVISORY_URL}`,
        },
      ])
    })

    it('reports a file that only holds a different address', () => {
      const other = 'https://github.com/hollware/other/security/advisories/new'
      const result = checkAdvisoryUrl({ files: files(other), expected: ADVISORY_URL })
      expect(result.map((violation) => violation.rule)).toEqual([
        'advisory-url/missing',
        'advisory-url/different',
      ])
    })
  })
})
