import { analyzeSource } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

export interface WorkerdTestsInput {
  tests: readonly TextFile[]
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

export function isTestConfig(path: string): boolean {
  return /(?:^|\/)(?:vitest(?:\.[\w-]+)?|vite)\.config\.[cm]?[jt]s$/.test(path)
}
