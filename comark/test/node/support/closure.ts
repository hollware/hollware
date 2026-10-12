// Walks the installed dependency closure of the packages this app uses and finds every import of a
// Node.js built-in in it. pnpm lays packages out so that a package's dependencies are its siblings in
// the same `node_modules` folder of the virtual store, which is what `closureOf` follows.
import { builtinModules } from 'node:module'
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

interface Manifest {
  name: string
  version: string
  dependencies?: Record<string, string>
}

export interface PackageInfo {
  id: string
  dir: string
  manifest: Manifest
}

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
}

/** `appDir/node_modules/<entry>` and everything it depends on (`dependencies` only, not peers). */
export function closureOf(appDir: string, entries: string[]): Map<string, PackageInfo> {
  const found = new Map<string, PackageInfo>()
  const visit = (dir: string): void => {
    const manifest = readManifest(dir)
    const id = `${manifest.name}@${manifest.version}`
    if (found.has(id)) return
    found.set(id, { id, dir, manifest })
    const nodeModules = manifest.name.startsWith('@') ? join(dir, '..', '..') : join(dir, '..')
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      visit(realpathSync(join(nodeModules, dependency)))
    }
  }
  for (const entry of entries) visit(realpathSync(join(appDir, 'node_modules', entry)))
  return found
}

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (/\.[cm]?js$/.test(name)) yield path
  }
}

export interface NodeImport {
  /** `name@version:path/inside/the/package`. */
  file: string
  builtins: string[]
}

/** Every file of the closure that imports, requires or dynamically imports a Node.js built-in. */
export function findNodeImports(closure: Map<string, PackageInfo>): NodeImport[] {
  const hits: NodeImport[] = []
  for (const { id, dir } of [...closure.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const file of sourceFiles(dir)) {
      const builtins = new Set<string>()
      for (const match of readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
        const specifier = match[1] ?? ''
        if (BUILTINS.has(specifier)) builtins.add(specifier)
      }
      if (builtins.size > 0) {
        hits.push({ file: `${id}:${relative(dir, file)}`, builtins: [...builtins].sort() })
      }
    }
  }
  return hits
}
