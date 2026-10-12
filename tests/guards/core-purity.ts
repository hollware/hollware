import { builtinModules } from 'node:module'
import { analyzeSource } from '../support/source.ts'
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
 */

export interface CorePurityInput {
  /** The files under `packages/core/src`. */
  files: readonly TextFile[]
  /** `packages/core/package.json`. */
  manifest: TextFile
}

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

export function checkCorePurity(input: CorePurityInput): Violation[] {
  const { manifests, violations } = parseManifests([input.manifest])
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
