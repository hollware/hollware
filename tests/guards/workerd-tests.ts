import { analyzeSource } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `workerd-tests`: the two kinds of test do not get mixed up, and the module cache stays
 * off where it breaks (`AGENTS.md`, "Workers in this repo").
 *
 * - A test that imports `vitest` or a `cloudflare:*` module runs inside workerd through
 *   `@cloudflare/vitest-plugin`, and is named `*.workerd.test.ts`. Tests with that name import
 *   the real `vitest`, never `vite-plus/test`, which the plugin cannot drive. (The lint
 *   override for `*.workerd.test.ts` exists for the same reason.)
 * - No Vitest config that uses `cloudflareTest` sets `fsModuleCache: true`: with it, Vitest 5
 *   and `@cloudflare/vitest-plugin` fail to read their module cache (workers-sdk#15618).
 */

export interface WorkerdTestsInput {
  /** Every test file of the repository (`*.test.*`, `*.spec.*`), with its text. */
  tests: readonly TextFile[]
  /** Every Vitest or Vite config of the repository, with its text. */
  configs: readonly TextFile[]
}

const WORKERD_TEST = /\.workerd\.test\.[cm]?[jt]sx?$/

export function checkWorkerdTests(input: WorkerdTestsInput): Violation[] {
  const violations: Violation[] = []
  for (const test of input.tests) {
    const { references } = analyzeSource(test.path, test.text)
    const named = WORKERD_TEST.test(test.path)
    const runsInWorkerd = references.find(
      (reference) =>
        reference.specifier === 'vitest' || reference.specifier.startsWith('cloudflare:'),
    )
    if (runsInWorkerd !== undefined && !named) {
      violations.push({
        rule: 'workerd-tests/name',
        file: test.path,
        message: `line ${runsInWorkerd.line} imports "${runsInWorkerd.specifier}", so the file runs inside workerd and must be named *.workerd.test.ts`,
      })
    }
    const viteTest = references.find((reference) => reference.specifier === 'vite-plus/test')
    if (named && viteTest !== undefined) {
      violations.push({
        rule: 'workerd-tests/imports',
        file: test.path,
        message: `line ${viteTest.line} imports "vite-plus/test": a *.workerd.test.ts file imports "vitest", which @cloudflare/vitest-plugin needs`,
      })
    }
  }
  for (const config of input.configs) {
    const analysis = analyzeSource(config.path, config.text)
    const usesPlugin = analysis.references.some(
      (reference) => reference.specifier === '@cloudflare/vitest-plugin',
    )
    if (!usesPlugin) continue
    for (const property of analysis.properties) {
      if (property.key === 'fsModuleCache' && property.value === true) {
        violations.push({
          rule: 'workerd-tests/module-cache',
          file: config.path,
          message: `line ${property.line} sets fsModuleCache: true, which breaks @cloudflare/vitest-plugin with Vitest 5 (workers-sdk#15618): keep it false`,
        })
      }
    }
  }
  return violations
}

/** Whether a repository file configures Vitest or Vite. */
export function isTestConfig(path: string): boolean {
  return /(?:^|\/)(?:vitest(?:\.[\w-]+)?|vite)\.config\.[cm]?[jt]s$/.test(path)
}
