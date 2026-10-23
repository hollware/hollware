import { isRecord, parseJson } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

export interface Manifest {
  path: string
  dir: string
  json: Record<string, unknown>
}

export function workspaceManifestPaths(
  globs: readonly string[],
  files: readonly string[],
): { paths: string[]; unsupportedGlobs: string[] } {
  const paths = ['package.json']
  const unsupportedGlobs: string[] = []
  for (const glob of globs) {
    const match = /^([\w.-]+(?:\/[\w.-]+)*)\/\*$/.exec(glob)
    const base = match?.[1]
    if (base === undefined) {
      unsupportedGlobs.push(glob)
      continue
    }
    const pattern = new RegExp(`^${base.replace(/[.]/g, '\\.')}/[^/]+/package\\.json$`)
    paths.push(...files.filter((file) => pattern.test(file)))
  }
  return { paths: paths.sort(), unsupportedGlobs }
}

export function parseManifests(files: readonly TextFile[]): {
  manifests: Manifest[]
  violations: Violation[]
} {
  const manifests: Manifest[] = []
  const violations: Violation[] = []
  for (const file of files) {
    const parsed = parseJson(file.text)
    if (!parsed.ok || !isRecord(parsed.value)) {
      violations.push({
        rule: 'manifest/invalid-json',
        file: file.path,
        message: parsed.ok
          ? 'package.json must hold a JSON object'
          : `package.json is not valid JSON: ${parsed.error}`,
      })
      continue
    }
    const dir = file.path === 'package.json' ? '' : file.path.slice(0, -'/package.json'.length)
    manifests.push({ path: file.path, dir, json: parsed.value })
  }
  return { manifests, violations }
}

export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const

export function dependencySpecs(
  manifest: Manifest,
  fields: readonly string[] = DEPENDENCY_FIELDS,
): { field: string; name: string; spec: unknown }[] {
  const found: { field: string; name: string; spec: unknown }[] = []
  for (const field of fields) {
    const value = manifest.json[field]
    if (!isRecord(value)) continue
    for (const [name, spec] of Object.entries(value)) found.push({ field, name, spec })
  }
  return found
}

export function isPublishable(manifest: Manifest): boolean {
  return /^packages\/[^/]+$/.test(manifest.dir) && manifest.json.private !== true
}
