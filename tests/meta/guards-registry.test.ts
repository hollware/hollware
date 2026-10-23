import { describe, expect, it } from 'vite-plus/test'
import { checkGuardsRegistry } from '../guards/guards-registry.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText, repoFiles } from '../support/repo.ts'

const GUARD_FILES = ['tests/conventions/a.test.ts', 'tests/meta/b.test.ts']

const registryFile = (section: string) =>
  file(
    'tests/AGENTS.md',
    `# Title\n\n## Guards\n\n${section}\n\n## Next\n\n- \`tests/conventions/not-here.test.ts\` outside the section.\n`,
  )

const ROOT = file(
  'AGENTS.md',
  '# Title\n\n## Guards\n\nWhat each guard binds is in `tests/AGENTS.md`.\n\n## Next\n\nMore.\n',
)

const GOOD = [
  '- `tests/conventions/a.test.ts` binds the manifests of every package to one shape.',
  '- `tests/meta/b.test.ts`: every AGENTS.md stays short enough to read whole.',
].join('\n')

const check = (text: string, guardFiles: string[] = GUARD_FILES, root = ROOT) =>
  checkGuardsRegistry({
    registry: text.startsWith('# ') ? file('tests/AGENTS.md', text) : registryFile(text),
    root,
    guardFiles,
  })

describe('guards registry', () => {
  it('every guard file is cited once in the Guards section of tests/AGENTS.md, and the root points there', () => {
    const guardFiles = repoFiles().filter((path) =>
      /^tests\/(?:conventions|meta)\/[^/]+$/.test(path),
    )
    expect(guardFiles.length).toBeGreaterThan(25)
    const violations = checkGuardsRegistry({
      registry: file('tests/AGENTS.md', readText('tests/AGENTS.md')),
      root: file('AGENTS.md', readText('AGENTS.md')),
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
          file: 'tests/AGENTS.md',
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
          file: 'tests/AGENTS.md',
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
          file: 'tests/AGENTS.md',
          message: 'line 7 cites tests/meta/b.test.ts again: each guard file has one line',
        },
      ])
    })

    it('does not count a citation outside the Guards section', () => {
      expect(check(GOOD)).toEqual([])
    })

    it('reports a tests/AGENTS.md without the section', () => {
      expect(check('# Title\n\nNo registry.\n')).toEqual([
        {
          rule: 'guards-registry/section-missing',
          file: 'tests/AGENTS.md',
          message: 'tests/AGENTS.md has no "## Guards" section: it lists what each guard binds',
        },
      ])
    })

    it('reports a root AGENTS.md whose Guards section does not point to the registry', () => {
      const pointer =
        'AGENTS.md has no "## Guards" section that cites `tests/AGENTS.md`: an agent that starts at the root finds the registry of what each guard binds there'
      const withoutSection = file('AGENTS.md', '# Title\n\n## Commands\n\nSee `tests/AGENTS.md`.\n')
      expect(check(GOOD, GUARD_FILES, withoutSection)).toEqual([
        { rule: 'guards-registry/no-pointer', file: 'AGENTS.md', message: pointer },
      ])
      const withoutCitation = file(
        'AGENTS.md',
        '# Title\n\n## Guards\n\nSee `tests/guards/` and `AGENTS.md`.\n',
      )
      expect(check(GOOD, GUARD_FILES, withoutCitation)).toEqual([
        { rule: 'guards-registry/no-pointer', file: 'AGENTS.md', message: pointer },
      ])
      const elsewhere = file(
        'AGENTS.md',
        '# Title\n\n## Guards\n\nSee the tests.\n\n## Other\n\n`tests/AGENTS.md`\n',
      )
      expect(check(GOOD, GUARD_FILES, elsewhere).map((violation) => violation.rule)).toEqual([
        'guards-registry/no-pointer',
      ])
    })

    it('reports a registry line left in the root AGENTS.md, whichever folder of tests/ it cites', () => {
      const root = file(
        'AGENTS.md',
        '# Title\n\n## Guards\n\nSee `tests/AGENTS.md`.\n\n- `tests/meta/b.test.ts`: every AGENTS.md stays short.\n',
      )
      expect(check(GOOD, GUARD_FILES, root)).toEqual([
        {
          rule: 'guards-registry/stray-line',
          file: 'AGENTS.md',
          message:
            'line 7 cites tests/meta/b.test.ts: the registry lives in tests/AGENTS.md, so this line belongs there',
        },
      ])
      const ci = file(
        'AGENTS.md',
        '# Title\n\n## Guards\n\nSee `tests/AGENTS.md`.\n\n- `tests/ci/promotion-check.test.ts`: the promotion gate refuses what is not on main.\n',
      )
      expect(check(GOOD, GUARD_FILES, ci).map((violation) => violation.message)).toEqual([
        'line 7 cites tests/ci/promotion-check.test.ts: the registry lives in tests/AGENTS.md, so this line belongs there',
      ])
      const pointer = file(
        'AGENTS.md',
        '# Title\n\n## Guards\n\n- The registry is `tests/AGENTS.md`.\n',
      )
      expect(check(GOOD, GUARD_FILES, pointer)).toEqual([])
    })
  })
})
