import { parse } from 'yaml'
import { describe, expect, it } from 'vite-plus/test'
import { checkSetupVpVersion } from '../guards/setup-vp-version.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { isWorkflowPath, readRepoFiles, readText } from '../support/repo.ts'
import { isRecord } from '../support/values.ts'

// Fails when: a voidzero-dev/setup-vp step pins a `version` that is not the vite-plus version of
// the catalog, or does not take Node from .node-version; or a setup-node step uses neither
// `node-version-file: .node-version` nor the exact version in .node-version.

const SHA = 'a'.repeat(40)

const step = (uses: string, inputs: string[]) =>
  [
    'permissions: {}',
    'jobs:',
    '  build:',
    '    steps:',
    `      - uses: ${uses}@${SHA} # v1.0.0`,
    '        with:',
    ...inputs.map((input) => `          ${input}`),
  ].join('\n')

const check = (text: string, viteVersion: { value: string | undefined } = { value: '1.1.0' }) =>
  checkSetupVpVersion({
    workflows: [file('.github/workflows/ci.yml', text)],
    viteVersion: viteVersion.value,
    nodeVersion: '24.21.0\n',
  })

const messages = (text: string) =>
  check(text).map((violation) => `${violation.rule}: ${violation.message}`)

describe('setup-vp version', () => {
  it('every setup-vp pins the catalog version of vite-plus and every Node comes from .node-version', () => {
    const workspace: unknown = parse(readText('pnpm-workspace.yaml'))
    const catalog = isRecord(workspace) ? workspace.catalog : undefined
    const viteVersion = isRecord(catalog) ? catalog['vite-plus'] : undefined
    expect(viteVersion).toBe('1.3.0')
    const violations = checkSetupVpVersion({
      workflows: readRepoFiles(isWorkflowPath),
      viteVersion: typeof viteVersion === 'string' ? viteVersion : undefined,
      nodeVersion: readText('.node-version'),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a matching version with Node from the file', () => {
      const good = step('voidzero-dev/setup-vp', [
        'version: 1.1.0',
        'node-version-file: .node-version',
      ])
      expect(check(good)).toEqual([])
    })

    it('reports a version that is not the catalog version', () => {
      const bad = step('voidzero-dev/setup-vp', [
        'version: 1.0.0',
        'node-version-file: .node-version',
      ])
      expect(check(bad)).toEqual([
        {
          rule: 'setup-vp-version/mismatch',
          file: '.github/workflows/ci.yml',
          message:
            'job "build", step 1: setup-vp "version" must be "1.1.0", the vite-plus version of the catalog, found "1.0.0"',
        },
      ])
    })

    it('reports a missing, ranged or non-string version', () => {
      for (const version of [[], ['version: latest'], ['version: ^1.1.0'], ['version: 1.1']]) {
        const bad = step('voidzero-dev/setup-vp', [...version, 'node-version-file: .node-version'])
        expect(check(bad).map((violation) => violation.rule)).toEqual(['setup-vp-version/mismatch'])
      }
    })

    it('reports setup-vp that takes Node from anywhere but .node-version', () => {
      const bad = step('voidzero-dev/setup-vp', ['version: 1.1.0', 'node-version: 24'])
      expect(messages(bad)).toEqual([
        'setup-vp-version/node-source: job "build", step 1: setup-vp must take Node from .node-version with "node-version-file: .node-version", found undefined',
      ])
    })

    it('accepts setup-node from the file or at the exact version, and reports anything else', () => {
      expect(check(step('actions/setup-node', ['node-version-file: .node-version']))).toEqual([])
      expect(check(step('actions/setup-node', ['node-version: 24.21.0']))).toEqual([])
      expect(messages(step('actions/setup-node', ['node-version: 24']))).toEqual([
        'setup-vp-version/node-source: job "build", step 1: setup-node must use "node-version-file: .node-version" or the exact "node-version: 24.21.0", found {"node-version":24}',
      ])
    })

    it('reports a catalog without vite-plus', () => {
      const good = step('voidzero-dev/setup-vp', [
        'version: 1.1.0',
        'node-version-file: .node-version',
      ])
      expect(check(good, { value: undefined })).toEqual([
        {
          rule: 'setup-vp-version/catalog',
          file: '.github/workflows/ci.yml',
          message: 'pnpm-workspace.yaml has no "vite-plus" catalog entry for setup-vp to match',
        },
      ])
    })
  })
})
