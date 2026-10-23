import { isRecord } from '../support/values.ts'
import type { Violation } from './types.ts'

export interface SingleCopiesInput {
  lockfile: unknown
}

export const SINGLE_COPY_PACKAGES = [
  '@modelcontextprotocol/server',
  'drizzle-orm',
  'hono',
  'zod',
] as const

const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies']

function snapshotKey(name: string, version: string): string | undefined {
  if (version.startsWith('link:')) return undefined
  const base = version.split('(')[0] ?? version
  return /^@?[^@]+@/.test(base) ? version : `${name}@${version}`
}

function nameAndVersion(key: string): [string, string] {
  const base = key.split('(')[0] ?? key
  const at = base.lastIndexOf('@')
  return [base.slice(0, at), base.slice(at + 1)]
}

export function checkSingleCopies(input: SingleCopiesInput): Violation[] {
  const report = (message: string): Violation[] => [
    { rule: 'single-copies', file: 'pnpm-lock.yaml', message },
  ]
  const lockfile = input.lockfile
  if (!isRecord(lockfile) || !isRecord(lockfile.importers)) {
    return report('the lockfile has no importers to walk')
  }
  const snapshots = isRecord(lockfile.snapshots) ? lockfile.snapshots : {}
  const queue: string[] = []
  for (const [path, importer] of Object.entries(lockfile.importers)) {
    if (path === '.' || !isRecord(importer)) continue
    for (const field of FIELDS) {
      const deps = importer[field]
      if (!isRecord(deps)) continue
      for (const [name, entry] of Object.entries(deps)) {
        const version = isRecord(entry) ? entry.version : undefined
        if (typeof version !== 'string') continue
        const key = snapshotKey(name, version)
        if (key !== undefined) queue.push(key)
      }
    }
  }
  const seen = new Set<string>()
  const versions = new Map<string, Set<string>>()
  while (queue.length > 0) {
    const key = queue.pop()
    if (key === undefined || seen.has(key)) continue
    seen.add(key)
    const [name, version] = nameAndVersion(key)
    versions.set(name, (versions.get(name) ?? new Set()).add(version))
    const snapshot = snapshots[key]
    if (!isRecord(snapshot)) continue
    for (const field of ['dependencies', 'optionalDependencies']) {
      const deps = snapshot[field]
      if (!isRecord(deps)) continue
      for (const [dep, depVersion] of Object.entries(deps)) {
        if (typeof depVersion !== 'string') continue
        const depKey = snapshotKey(dep, depVersion)
        if (depKey !== undefined) queue.push(depKey)
      }
    }
  }
  const violations: Violation[] = []
  for (const name of SINGLE_COPY_PACKAGES) {
    const found = [...(versions.get(name) ?? [])].sort()
    if (found.length > 1) {
      violations.push(
        ...report(
          `${name} resolves to ${found.length} versions in what the workspace packages and apps install, ${found.join(', ')}: pin the catalog to the version the lockfile already has, or move every dependent together`,
        ),
      )
    }
  }
  return violations
}
