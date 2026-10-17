import { describe, expect, it } from 'vite-plus/test'
import { checkPackageLists } from '../guards/package-lists.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'
import { isRecord } from '../support/values.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: the Layout of AGENTS.md lacks a bullet for a workspace package directory, the package
// table of README.md or the Versions section of .changeset/README.md lists a package that is not
// published or leaves one out, links it to the wrong directory, or gets the count wrong.

const AGENTS = [
  '# Agents',
  '',
  '## Layout',
  '',
  '- `packages/core` — the core.',
  '- `packages/cli` — the CLI.',
  '- `apps/playground` — a playground.',
  '- `examples/` — sites.',
  '',
  '## Next',
  '',
  '- `packages/ghost` — outside the Layout section.',
].join('\n')

const README = [
  '# Project',
  '',
  '## Packages',
  '',
  'Two packages, planned to arrive in order.',
  '',
  '| Package | What it will be |',
  '| --- | --- |',
  '| [`@hollware/core`](packages/core) | The core. |',
  '| [`hollware`](packages/cli) | The CLI. |',
  '',
  '## Next',
].join('\n')

const CHANGESETS = [
  '# Changesets',
  '',
  '## Versions',
  '',
  'The two published packages (`@hollware/core` and `hollware`) share one version.',
  'Apps like `@hollware/playground` are private.',
  '',
  '## Releasing',
].join('\n')

const PUBLISHED = [
  { name: '@hollware/core', dir: 'packages/core' },
  { name: 'hollware', dir: 'packages/cli' },
]

const check = (overrides: Partial<Record<'agents' | 'readme' | 'changesets', string>> = {}) =>
  checkPackageLists({
    agents: file('AGENTS.md', overrides.agents ?? AGENTS),
    readme: file('README.md', overrides.readme ?? README),
    changesetReadme: file('.changeset/README.md', overrides.changesets ?? CHANGESETS),
    workspaceDirs: ['packages/core', 'packages/cli', 'apps/playground'],
    workspaceNames: ['@hollware/core', 'hollware', '@hollware/playground'],
    published: PUBLISHED,
  })

const messages = (overrides?: Parameters<typeof check>[0]) =>
  check(overrides).map((violation) => `${violation.rule}: ${violation.message}`)

function realInput() {
  const workspaceDirs: string[] = []
  const workspaceNames: string[] = []
  const published: { name: string; dir: string }[] = []
  for (const manifest of workspaceManifests()) {
    if (manifest.path === 'package.json') continue
    const dir = manifest.path.replace(/\/package\.json$/, '')
    workspaceDirs.push(dir)
    const json: unknown = JSON.parse(manifest.text)
    if (isRecord(json) && typeof json.name === 'string') workspaceNames.push(json.name)
    if (
      isRecord(json) &&
      dir.startsWith('packages/') &&
      typeof json.name === 'string' &&
      json.private !== true
    ) {
      published.push({ name: json.name, dir })
    }
  }
  return { workspaceDirs, workspaceNames, published }
}

describe('package lists', () => {
  it('AGENTS.md, README.md and .changeset/README.md list the packages that exist', () => {
    const { workspaceDirs, workspaceNames, published } = realInput()
    expect(workspaceDirs).toHaveLength(20)
    expect(published).toHaveLength(11)
    const violations = checkPackageLists({
      agents: file('AGENTS.md', readText('AGENTS.md')),
      readme: file('README.md', readText('README.md')),
      changesetReadme: file('.changeset/README.md', readText('.changeset/README.md')),
      workspaceDirs,
      workspaceNames,
      published,
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts lists that match', () => {
      expect(check()).toEqual([])
    })

    it('reports a package directory with no Layout bullet', () => {
      expect(
        messages({ agents: AGENTS.replace('- `apps/playground` — a playground.\n', '') }),
      ).toEqual([
        'package-lists/agents-layout: the "## Layout" section has no bullet for `apps/playground`: add one',
      ])
      expect(messages({ agents: '# Agents\n' })).toEqual([
        'package-lists/agents-layout: AGENTS.md has no "## Layout" section listing the packages',
      ])
    })

    it('reports a published package missing from the README table, or linked to the wrong place', () => {
      expect(
        messages({ readme: README.replace('| [`hollware`](packages/cli) | The CLI. |\n', '') }),
      ).toEqual([
        'package-lists/readme-table: the package table under "## Packages" has no row for hollware: add one linking to packages/cli',
      ])
      expect(messages({ readme: README.replace('(packages/cli)', '(packages/other)') })).toEqual([
        'package-lists/readme-table: the row of hollware links to packages/other but the package lives in packages/cli',
      ])
    })

    it('reports a README row for a package that is not published', () => {
      const readme = README.replace(
        '\n\n## Next',
        '\n| [`@hollware/ghost`](packages/ghost) | A ghost. |\n\n## Next',
      )
      expect(messages({ readme })).toEqual([
        'package-lists/readme-table: the package table lists @hollware/ghost, which is not a published package',
      ])
    })

    it('reports a wrong count in the README and in the changeset README', () => {
      expect(messages({ readme: README.replace('Two packages,', 'Three packages,') })).toEqual([
        'package-lists/count-word: the "## Packages" section must start with "Two packages,", the number of published packages, found "three"',
      ])
      expect(
        messages({ changesets: CHANGESETS.replace('The two published', 'The three published') }),
      ).toEqual([
        'package-lists/count-word: the "## Versions" section must say "The two published packages", found "three"',
      ])
    })

    it('reports a changeset README that leaves a package out or names one that does not exist', () => {
      expect(
        messages({
          changesets: CHANGESETS.replace('(`@hollware/core` and `hollware`)', '(`hollware`)'),
        }),
      ).toEqual([
        'package-lists/changeset-readme: the "## Versions" section does not name @hollware/core',
      ])
      expect(
        messages({
          changesets: CHANGESETS.replace('`hollware`)', '`hollware` and `@hollware/ghost`)'),
        }),
      ).toEqual([
        'package-lists/changeset-readme: the "## Versions" section names @hollware/ghost, which is not a package of this workspace',
      ])
    })
  })
})
