import { builtinModules } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { parseJsonc } from '../support/jsonc.ts'
import { analyzeSource } from '../support/source.ts'
import { isRecord, recordAt } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

export interface CorePurityInput {
  files: readonly TextFile[]
  manifest: TextFile
  tsconfig: TextFile
  testFiles: readonly string[]
  testRuns: readonly { file: string; project: string }[]
}

const SOURCE_TYPES = { include: ['src'], lib: ['es2024', 'webworker'], types: [] }

const CORE_TEST_PROJECTS = ['@hollware/core', 'core:workerd']

const BARE_BUILTINS: ReadonlySet<string> = new Set(builtinModules)

export function forbiddenSpecifierReason(specifier: string): string | undefined {
  if (specifier.startsWith('node:')) return 'a Node module'
  if (specifier.startsWith('cloudflare:')) return 'a Cloudflare runtime module'
  if (specifier.startsWith('@cloudflare/')) return 'a Cloudflare package'
  if (specifier === 'wrangler' || specifier.startsWith('wrangler/')) return 'wrangler'
  if (BARE_BUILTINS.has(specifier)) return 'a Node built-in'
  return undefined
}

function checkTypeEnvironment(tsconfig: TextFile): Violation[] {
  const report = (message: string): Violation[] => [
    { rule: 'core-purity/types', file: tsconfig.path, message },
  ]
  const parsed = parseJsonc(tsconfig.text)
  if (!parsed.ok) return report(`the file does not parse, so it cannot be checked: ${parsed.error}`)
  const options = recordAt(parsed.value, 'compilerOptions')
  const found = {
    include: isRecord(parsed.value) ? parsed.value.include : undefined,
    lib: options?.lib,
    types: options?.types,
  }
  return isDeepStrictEqual(found, SOURCE_TYPES)
    ? []
    : report(
        `must type-check only src against the web platform, ${JSON.stringify(SOURCE_TYPES)}, so that a Node or browser global is a type error; found ${JSON.stringify(found)}`,
      )
}

function checkTestRuntimes(input: CorePurityInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.testFiles) {
    const projects = input.testRuns
      .filter((run) => run.file === file)
      .map((run) => run.project)
      .sort()
    if (!isDeepStrictEqual(projects, [...CORE_TEST_PROJECTS].sort())) {
      violations.push({
        rule: 'core-purity/runtimes',
        file,
        message: `runs in ${JSON.stringify(projects)}: every test of core runs in Node and inside workerd, ${JSON.stringify(CORE_TEST_PROJECTS)}`,
      })
    }
  }
  return violations
}

export function checkCorePurity(input: CorePurityInput): Violation[] {
  const { manifests, violations } = parseManifests([input.manifest])
  violations.push(...checkTypeEnvironment(input.tsconfig), ...checkTestRuntimes(input))
  for (const manifest of manifests) {
    for (const { field, name } of dependencySpecs(manifest, [
      'dependencies',
      'peerDependencies',
      'optionalDependencies',
    ])) {
      if (name === 'wrangler' || name.startsWith('@cloudflare/')) {
        violations.push({
          rule: 'core-purity/dependency',
          file: manifest.path,
          message: `${field} lists ${name}: core has no Cloudflare dependency (a tool belongs in devDependencies)`,
        })
      }
    }
  }
  for (const file of input.files) {
    const analysis = analyzeSource(file.path, file.text)
    for (const error of analysis.syntaxErrors) {
      violations.push({
        rule: 'core-purity/syntax-error',
        file: file.path,
        message: `the file does not parse, so it cannot be checked: ${error}`,
      })
    }
    for (const reference of analysis.references) {
      const reason = forbiddenSpecifierReason(reference.specifier)
      if (reason !== undefined) {
        violations.push({
          rule: 'core-purity/import',
          file: file.path,
          message: `line ${reference.line} imports "${reference.specifier}", ${reason}: core must run anywhere`,
        })
      }
    }
    for (const global of analysis.globals) {
      violations.push({
        rule: 'core-purity/global',
        file: file.path,
        message: `line ${global.line} uses the Node global "${global.name}": core must run anywhere`,
      })
    }
  }
  return violations
}
