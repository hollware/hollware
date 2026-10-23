import { isMap, mapEntry, plain, readYaml } from '../support/yaml.ts'
import type { TextFile, Violation } from './types.ts'

export interface PatchesInput {
  workspace: TextFile
  readPatch: (path: string) => string | undefined
  testFiles: readonly TextFile[]
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
