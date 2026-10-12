import { builtinModules } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import { parseJsonc } from '../support/jsonc.ts'
import { analyzeSource } from '../support/source.ts'
import { isRecord, recordAt } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

/**
 * Guard `core-purity`: `@hollware/core` runs anywhere (Workers, Node, browsers), so its
 * source never imports `cloudflare:*`, `@cloudflare/*`, `wrangler`, `node:*` or a Node
 * built-in by its bare name (`fs`, `path`), and never touches the Node globals `process`,
 * `Buffer`, `__dirname`, `__filename` and `require` (`globalThis.process` included).
 *
 * The files are parsed, so comments and strings never count. Limits are those of
 * `analyzeSource`: only literal specifiers are read, and a global is found by its name
 * without scope analysis, so a local variable called `process` is reported too (rename it).
 * A userland package that shares a name with a Node built-in (`buffer`, `events`) is reported
 * as well; import it with a trailing slash (`buffer/`) to tell Node and npm apart.
 *
 * The manifest of core may not depend on Cloudflare either: its `dependencies`,
 * `peerDependencies` and `optionalDependencies` hold no `@cloudflare/*` package and no
 * `wrangler` ("No Cloudflare dependencies", as its README says). Dev dependencies are tools.
 *
 * Two more facts keep the claim true beyond those names (ADR-018). `packages/core/tsconfig.json`
 * covers only `src`, with the web platform as its type environment (`lib` es2024 and webworker,
 * no `types`), so `vp check` rejects any other Node or browser global. And every test file of
 * `packages/core/tests` runs twice: in Node and inside workerd.
 */

export interface CorePurityInput {
  /** The files under `packages/core/src`. */
  files: readonly TextFile[]
  /** `packages/core/package.json`. */
  manifest: TextFile
  /** `packages/core/tsconfig.json`: the type environment of `src`. */
  tsconfig: TextFile
  /** The test files under `packages/core/tests`. */
  testFiles: readonly string[]
  /** Where Vitest runs each test file of the repository, as `vp test list` reports it. */
  testRuns: readonly { file: string; project: string }[]
}

/** The type environment of core's `src`: the web platform, no Node and no DOM (ADR-018). */
const SOURCE_TYPES = { include: ['src'], lib: ['es2024', 'webworker'], types: [] }

/** The projects each test of core runs in: Node, then workerd. */
const CORE_TEST_PROJECTS = ['@hollware/core', 'core:workerd']

const BARE_BUILTINS: ReadonlySet<string> = new Set(builtinModules)

/** Why a module specifier is not allowed in core, or `undefined` when it is. */
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
        `must type-check only src against the web platform, ${JSON.stringify(SOURCE_TYPES)}, so that a Node or browser global is a type error (ADR-018); found ${JSON.stringify(found)}`,
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
        message: `runs in ${JSON.stringify(projects)}: every test of core runs in Node and inside workerd, ${JSON.stringify(CORE_TEST_PROJECTS)} (ADR-018)`,
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
