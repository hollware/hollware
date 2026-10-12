import { describe, expect, it } from 'vite-plus/test'
import { checkPatches } from '../guards/patches.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { isTestFile } from '../guards/test-projects.ts'
import { readRepoFiles, readText, repoFiles } from '../support/repo.ts'

// Fails when: pnpm-workspace.yaml gets `patchedDependencies` and a patch file is missing, does not
// start with a `PATCHED (<reason>)` line, or is mentioned by no test file; or a .patch file exists
// that patchedDependencies does not list.

const workspace = (patched: string) =>
  file('pnpm-workspace.yaml', `packages:\n  - packages/*\n${patched}`)

const PATCH =
  'PATCHED (left-pad 1.3.0 crashes on empty strings; upstream issue 42)\n--- a/index.js\n+++ b/index.js\n'

const check = (
  patched: string,
  options: {
    patches?: Record<string, string>
    tests?: Record<string, string>
    patchFiles?: string[]
  } = {},
) =>
  checkPatches({
    workspace: workspace(patched),
    readPatch: (path) => options.patches?.[path],
    testFiles: Object.entries(options.tests ?? {}).map(([path, text]) => file(path, text)),
    patchFiles: options.patchFiles ?? Object.keys(options.patches ?? {}),
  })

const messages = (...args: Parameters<typeof check>) =>
  check(...args).map((violation) => `${violation.rule}: ${violation.message}`)

describe('dependency patches', () => {
  it('there are none, or each one is explained and tested', () => {
    const violations = checkPatches({
      workspace: file('pnpm-workspace.yaml', readText('pnpm-workspace.yaml')),
      readPatch: (path) => (repoFiles().includes(path) ? readText(path) : undefined),
      testFiles: readRepoFiles(isTestFile),
      patchFiles: repoFiles().filter((path) => path.endsWith('.patch')),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const patched = 'patchedDependencies:\n  left-pad@1.3.0: patches/left-pad@1.3.0.patch\n'
    const patches = { 'patches/left-pad@1.3.0.patch': PATCH }
    const tests = {
      'packages/core/tests/left-pad.test.ts': "import '../../../patches/left-pad@1.3.0.patch'",
    }

    it('accepts a workspace with no patches', () => {
      expect(check('')).toEqual([])
    })

    it('accepts a patch with a reason that a test mentions', () => {
      expect(check(patched, { patches, tests })).toEqual([])
    })

    it('accepts a test that mentions the patch by its file name only', () => {
      expect(
        check(patched, { patches, tests: { 'a.test.ts': "readFile('left-pad@1.3.0.patch')" } }),
      ).toEqual([])
    })

    it('reports a patch file that does not exist', () => {
      expect(check(patched, { tests })).toEqual([
        {
          rule: 'patches/missing-file',
          file: 'pnpm-workspace.yaml',
          message:
            'patchedDependencies["left-pad@1.3.0"] points at patches/left-pad@1.3.0.patch, which does not exist',
        },
      ])
    })

    it('reports a patch that does not start with a PATCHED (reason) line', () => {
      const plain = { 'patches/left-pad@1.3.0.patch': '--- a/index.js\n+++ b/index.js\n' }
      expect(check(patched, { patches: plain, tests })).toEqual([
        {
          rule: 'patches/reason',
          file: 'patches/left-pad@1.3.0.patch',
          message:
            'the first line must be "PATCHED (<reason>)", saying why left-pad@1.3.0 is patched, found "--- a/index.js"',
        },
      ])
      for (const first of [
        'PATCHED',
        'PATCHED ()',
        'patched (why we patch it)',
        ' PATCHED (why we patch it)',
      ]) {
        const bad = { 'patches/left-pad@1.3.0.patch': `${first}\n--- a/x` }
        expect(
          messages(patched, { patches: bad, tests }).map((message) => message.split(':')[0]),
        ).toEqual(['patches/reason'])
      }
    })

    it('reports a patch that no test mentions, and ignores the guards themselves', () => {
      expect(messages(patched, { patches })).toEqual([
        'patches/untested: no test file mentions patches/left-pad@1.3.0.patch: add a test that fails when the patch stops applying or stops being needed',
      ])
      const onlyGuards = {
        'tests/conventions/patches.test.ts': 'patches/left-pad@1.3.0.patch',
        'tests/meta/other.test.ts': 'left-pad@1.3.0.patch',
      }
      expect(
        check(patched, { patches, tests: onlyGuards }).map((violation) => violation.rule),
      ).toEqual(['patches/untested'])
    })

    it('reports a .patch file that patchedDependencies does not list', () => {
      expect(check('', { patchFiles: ['patches/orphan.patch'] })).toEqual([
        {
          rule: 'patches/orphan',
          file: 'patches/orphan.patch',
          message:
            'the patch is not listed in patchedDependencies of pnpm-workspace.yaml, so pnpm never applies it',
        },
      ])
    })
  })
})
