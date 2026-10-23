import { builtinModules } from 'node:module'
import { analyzeSource } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

export interface DeclaredImportsInput {
  manifests: readonly TextFile[]
  sources: readonly TextFile[]
  allowedVirtualImports?: readonly string[]
}

const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/

export function isScannedSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !path.endsWith('/worker-configuration.d.ts')
}

const BUILTINS: ReadonlySet<string> = new Set(builtinModules)

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

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

  const allowed = new Set(input.allowedVirtualImports ?? [])
  const used = new Set<string>()
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
      if (allowed.has(`${file.path}#${specifier}`)) {
        used.add(`${file.path}#${specifier}`)
        continue
      }
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
  for (const entry of allowed) {
    if (used.has(entry)) continue
    violations.push({
      rule: 'declared-imports/unused-exception',
      file: 'tests/guards/exceptions.ts',
      message: `the allowed virtual import \`${entry}\` is no longer needed (no such import): remove it from VIRTUAL_IMPORTS and lower its max`,
    })
  }
  return violations
}
