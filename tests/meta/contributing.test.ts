import { describe, expect, it } from 'vite-plus/test'
import { checkContributing, commandTable } from '../guards/contributing.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'
import { isRecord } from '../support/values.ts'

const CONTRIBUTING = [
  '# Contributing',
  '',
  '## Prerequisites',
  '',
  '- **Node.js 24.21.0**, the version pinned in `.node-version`.',
  '- **pnpm 12**, at the exact version pinned in `packageManager`.',
  '',
  '## Commands',
  '',
  '| Command | What it does |',
  '| --- | --- |',
  '| `pnpm install` | Install |',
  '| `pnpm exec vp check` | Check |',
  '| `pnpm exec vp run check:push` | Everything |',
  '',
  '## Tests',
].join('\n')

const AGENTS = [
  '# Agents',
  '',
  '## Commands',
  '',
  '| Command | What it does |',
  '| --- | --- |',
  '| `pnpm install` | Install |',
  '| `vp check` | Check |',
  '| `vp run check:push` | Everything |',
  '',
  '## Layout',
].join('\n')

const check = (
  overrides: { contributing?: string; agents?: string; node?: string; pm?: string } = {},
) =>
  checkContributing({
    contributing: file('CONTRIBUTING.md', overrides.contributing ?? CONTRIBUTING),
    agents: file('AGENTS.md', overrides.agents ?? AGENTS),
    nodeVersion: overrides.node ?? '24.21.0\n',
    packageManager: overrides.pm ?? 'pnpm@12.11.2+sha512.abc',
  })

describe('CONTRIBUTING.md', () => {
  it('names the pinned Node.js and pnpm, and the commands AGENTS.md lists', () => {
    const manifest: unknown = JSON.parse(readText('package.json'))
    const packageManager = isRecord(manifest) ? manifest.packageManager : undefined
    expect(typeof packageManager).toBe('string')
    const violations = checkContributing({
      contributing: file('CONTRIBUTING.md', readText('CONTRIBUTING.md')),
      agents: file('AGENTS.md', readText('AGENTS.md')),
      nodeVersion: readText('.node-version'),
      packageManager: typeof packageManager === 'string' ? packageManager : '',
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts matching versions and commands', () => {
      expect(check()).toEqual([])
    })

    it('reports a Node.js version that is not the pinned one', () => {
      expect(check({ node: '24.22.0\n' })).toEqual([
        {
          rule: 'contributing/node-version',
          file: 'CONTRIBUTING.md',
          message: '"Prerequisites" says Node.js 24.21.0 but .node-version pins 24.22.0',
        },
      ])
      expect(
        check({
          contributing: CONTRIBUTING.replace('**Node.js 24.21.0**', 'a recent Node.js'),
        }).map((violation) => violation.message),
      ).toEqual(['"Prerequisites" says Node.js (no version) but .node-version pins 24.21.0'])
    })

    it('reports a pnpm major that is not the pinned one', () => {
      expect(check({ pm: 'pnpm@13.0.0+sha512.abc' })).toEqual([
        {
          rule: 'contributing/pnpm-major',
          file: 'CONTRIBUTING.md',
          message: '"Prerequisites" says pnpm 12 but packageManager pins pnpm 13',
        },
      ])
    })

    it('reports commands that differ from the AGENTS.md table, in both directions', () => {
      const agents = AGENTS.replace(
        '| `vp run check:push` | Everything |',
        '| `vp run check:push` | Everything |\n| `vp run -r build` | Build |',
      )
      expect(check({ agents }).map((violation) => violation.message)).toEqual([
        'the commands table must list the same commands as AGENTS.md; missing: ["vp run -r build"], extra: []',
      ])
      const contributing = CONTRIBUTING.replace(
        '| `pnpm install` | Install |',
        '| `pnpm install` | Install |\n| `pnpm exec vp lint` | Lint |',
      )
      expect(check({ contributing }).map((violation) => violation.message)).toEqual([
        'the commands table must list the same commands as AGENTS.md; missing: [], extra: ["vp lint"]',
      ])
    })

    it('reports a CONTRIBUTING.md without a commands table', () => {
      expect(
        check({ contributing: CONTRIBUTING.replace('## Commands', '## Other') }).map(
          (violation) => violation.message,
        ),
      ).toEqual(['the "## Commands" table of CONTRIBUTING.md is missing or lists no command'])
    })

    it('reads the first column of a table and writes `pnpm exec vp` as `vp`', () => {
      expect(commandTable(CONTRIBUTING)).toEqual(['pnpm install', 'vp check', 'vp run check:push'])
      expect(
        commandTable('## Commands\n\n| `pnpm exec changeset` | x |\n| not code | y |'),
      ).toEqual(['pnpm exec changeset'])
    })
  })
})
