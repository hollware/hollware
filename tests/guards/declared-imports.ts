import { builtinModules } from 'node:module'
import { analyzeSource } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

/**
 * Guard `declared-imports`: every bare import is declared in the `package.json` of the
 * package that imports it (`dependencies`, `devDependencies` or `peerDependencies`).
 *
 * The check matters because Node resolves a package by walking up the directory tree: code in
 * `packages/core` that imports `yaml` works on this machine because the root declares it,
 * and breaks for whoever installs `@hollware/core`. The type check cannot see that.
 *
 * A file belongs to the package whose directory is its closest ancestor, and files outside
 * every workspace package (`scripts/`, `tests/`, the root `vite.config.ts`) belong to the
 * root. Allowed without a declaration: relative imports, `node:*`, `cloudflare:*` and the
 * package's own name. Subpaths are normalized (`vite-plus/test` is `vite-plus`,
 * `@scope/pkg/x` is `@scope/pkg`). Anything else that is not a bare package name (`#alias`,
 * `~/x`, `https://...`, `virtual:x`) is reported, because nothing resolves it for a consumer.
 */

export interface DeclaredImportsInput {
  /** The `package.json` of the root and of every workspace package. */
  manifests: readonly TextFile[]
  /** The source files to scan, with their text. */
  sources: readonly TextFile[]
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/

/** Whether the guard scans a repository file: source code, minus what a tool generates. */
export function isScannedSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !path.endsWith('/worker-configuration.d.ts')
}

const BUILTINS: ReadonlySet<string> = new Set(builtinModules)

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

/** The package a bare specifier names, or `undefined` when it is not a package name. */
export function packageOf(specifier: string): string | undefined {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
  return PACKAGE_NAME.test(name) ? name : undefined
}

interface PackageInfo {
  dir: string
  name: string | undefined
  declared: ReadonlySet<string>
}

function ownerOf(path: string, packages: readonly PackageInfo[]): PackageInfo | undefined {
  let best: PackageInfo | undefined
  for (const candidate of packages) {
    const inside = candidate.dir === '' || path.startsWith(`${candidate.dir}/`)
    if (inside && (best === undefined || candidate.dir.length > best.dir.length)) best = candidate
  }
  return best
}

export function checkDeclaredImports(input: DeclaredImportsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  const packages: PackageInfo[] = manifests.map((manifest) => ({
    dir: manifest.dir,
    name: typeof manifest.json.name === 'string' ? manifest.json.name : undefined,
    declared: new Set(
      dependencySpecs(manifest, ['dependencies', 'devDependencies', 'peerDependencies']).map(
        (dependency) => dependency.name,
      ),
    ),
  }))

  for (const file of input.sources) {
    const owner = ownerOf(file.path, packages)
    const analysis = analyzeSource(file.path, file.text)
    for (const error of analysis.syntaxErrors) {
      violations.push({
        rule: 'declared-imports/syntax-error',
        file: file.path,
        message: `the file does not parse, so its imports cannot be checked: ${error}`,
      })
    }
    for (const { specifier, line } of analysis.references) {
      if (/^\.\.?(?:\/|$)/.test(specifier)) continue
      if (specifier.startsWith('node:') || specifier.startsWith('cloudflare:')) continue
      const name = packageOf(specifier)
      if (name === undefined) {
        violations.push({
          rule: 'declared-imports/unsupported',
          file: file.path,
          message: `line ${line} imports "${specifier}", which is not a package name or a relative path: a consumer cannot resolve it`,
        })
        continue
      }
      if (owner === undefined || name === owner.name || owner.declared.has(name)) continue
      const manifest = owner.dir === '' ? 'package.json' : `${owner.dir}/package.json`
      violations.push({
        rule: 'declared-imports/undeclared',
        file: file.path,
        message: BUILTINS.has(specifier)
          ? `line ${line} imports the Node built-in "${specifier}" by its bare name: write "node:${specifier}"`
          : `line ${line} imports "${specifier}" (package ${name}), which ${manifest} does not declare: add it to dependencies, devDependencies or peerDependencies`,
      })
    }
  }
  return violations
}
