import { isMap, mapEntry, plain, readYaml } from '../support/yaml.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `patches`: a dependency patch is explained and tested.
 *
 * When `pnpm-workspace.yaml` has `patchedDependencies`, each patch file exists, starts with a
 * `PATCHED (<reason>)` line that says why the dependency is patched, and is mentioned by at
 * least one test file, so that something fails when the patch stops applying or stops being
 * needed. Test files of the guards themselves (`tests/guards`, `tests/conventions`,
 * `tests/meta`, `tests/support`) do not count. A `.patch` file that `patchedDependencies`
 * does not list is reported, because it looks applied and is not. Today there are none.
 */

export interface PatchesInput {
  workspace: TextFile
  /** The text of a repository file, or `undefined` when it does not exist. */
  readPatch: (path: string) => string | undefined
  /** The test files of the repository, with their text. */
  testFiles: readonly TextFile[]
  /** Every `.patch` file of the repository. */
  patchFiles: readonly string[]
}

const GUARD_DIRECTORIES = ['tests/guards/', 'tests/conventions/', 'tests/meta/', 'tests/support/']

export function checkPatches(input: PatchesInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, file: string, message: string): void => {
    violations.push({ rule: `patches/${rule}`, file, message })
  }

  const yaml = readYaml(input.workspace.text)
  const root = yaml.doc.contents
  const entry = isMap(root) ? mapEntry(root, 'patchedDependencies') : undefined
  const patched = plain(entry?.value)
  const patches: { dependency: string; path: string }[] = []
  if (typeof patched === 'object' && patched !== null && !Array.isArray(patched)) {
    for (const [dependency, path] of Object.entries(patched)) {
      if (typeof path === 'string') patches.push({ dependency, path: path.replace(/^\.\//, '') })
    }
  }

  const counted = input.testFiles.filter(
    (file) => !GUARD_DIRECTORIES.some((directory) => file.path.startsWith(directory)),
  )
  for (const { dependency, path } of patches) {
    const text = input.readPatch(path)
    if (text === undefined) {
      report(
        'missing-file',
        input.workspace.path,
        `patchedDependencies["${dependency}"] points at ${path}, which does not exist`,
      )
      continue
    }
    const first = text.split('\n')[0] ?? ''
    if (!/^PATCHED \(.{3,}\)$/.test(first)) {
      report(
        'reason',
        path,
        `the first line must be "PATCHED (<reason>)", saying why ${dependency} is patched, found ${JSON.stringify(first)}`,
      )
    }
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (!counted.some((file) => file.text.includes(path) || file.text.includes(name))) {
      report(
        'untested',
        path,
        `no test file mentions ${path}: add a test that fails when the patch stops applying or stops being needed`,
      )
    }
  }
  const listed = new Set(patches.map((patch) => patch.path))
  for (const path of input.patchFiles) {
    if (!listed.has(path)) {
      report(
        'orphan',
        path,
        'the patch is not listed in patchedDependencies of pnpm-workspace.yaml, so pnpm never applies it',
      )
    }
  }
  return violations
}
