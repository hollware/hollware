import { describe, expect, it } from 'vite-plus/test'
import { checkGuardsRegistry } from '../guards/guards-registry.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText, repoFiles } from '../support/repo.ts'

// Fails when: a file under tests/conventions/ or tests/meta/ is not cited, once, in the "## Guards"
// section of the root AGENTS.md with a line that says what it binds, or a line cites a missing file.

const GUARD_FILES = ['tests/conventions/a.test.ts', 'tests/meta/b.test.ts']

const agents = (section: string) =>
  file(
    'AGENTS.md',
    `# Title\n\n## Guards\n\n${section}\n\n## Next\n\n- \`tests/conventions/not-here.test.ts\` outside the section.\n`,
  )

const GOOD = [
  '- `tests/conventions/a.test.ts` binds the manifests of every package to one shape.',
  '- `tests/meta/b.test.ts`: every AGENTS.md stays short enough to read whole.',
].join('\n')

const check = (text: string, guardFiles: string[] = GUARD_FILES) =>
  checkGuardsRegistry({
    agents: text.startsWith('# ') ? file('AGENTS.md', text) : agents(text),
    guardFiles,
  })

describe('guards registry', () => {
  it('every guard file is cited once in the Guards section of AGENTS.md, and no line cites a missing one', () => {
    const guardFiles = repoFiles().filter((path) =>
      /^tests\/(?:conventions|meta)\/[^/]+$/.test(path),
    )
    expect(guardFiles.length).toBeGreaterThan(25)
    const violations = checkGuardsRegistry({
      agents: file('AGENTS.md', readText('AGENTS.md')),
      guardFiles,
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a registry that cites every guard file once with a description', () => {
      expect(check(GOOD)).toEqual([])
    })

    it('reports a guard file that is not cited', () => {
      expect(check(GOOD, [...GUARD_FILES, 'tests/meta/new.test.ts'])).toEqual([
        {
          rule: 'guards-registry/uncited',
          file: 'AGENTS.md',
          message:
            'tests/meta/new.test.ts is not cited in the "## Guards" section: add one line saying what it binds',
        },
      ])
    })

    it('reports a line that cites a file that does not exist', () => {
      const text = `${GOOD}\n- \`tests/meta/gone.test.ts\` used to bind something important.`
      expect(check(text)).toEqual([
        {
          rule: 'guards-registry/missing-file',
          file: 'AGENTS.md',
          message:
            'line 7 cites tests/meta/gone.test.ts, which does not exist: fix the path or remove the line',
        },
      ])
    })

    it('reports a line that does not say what the guard binds', () => {
      const text = '- `tests/conventions/a.test.ts`\n- `tests/meta/b.test.ts`: checks stuff.'
      expect(check(text).map((violation) => violation.rule)).toEqual([
        'guards-registry/no-description',
        'guards-registry/no-description',
      ])
      expect(check(text)[0]?.message).toBe(
        'line 5 cites tests/conventions/a.test.ts without saying what it binds: write at least 4 words after the path',
      )
    })

    it('reports a file cited on two lines', () => {
      const text = `${GOOD}\n- \`tests/meta/b.test.ts\` is also described a second time here.`
      expect(check(text)).toEqual([
        {
          rule: 'guards-registry/duplicate',
          file: 'AGENTS.md',
          message: 'line 7 cites tests/meta/b.test.ts again: each guard file has one line',
        },
      ])
    })

    it('does not count a citation outside the Guards section', () => {
      // The fixture cites tests/conventions/not-here.test.ts after the section: it is not a registry line.
      expect(check(GOOD)).toEqual([])
    })

    it('reports an AGENTS.md without the section', () => {
      expect(check('# Title\n\nNo registry.\n')).toEqual([
        {
          rule: 'guards-registry/section-missing',
          file: 'AGENTS.md',
          message: 'AGENTS.md has no "## Guards" section: it lists what each guard binds',
        },
      ])
    })
  })
})
