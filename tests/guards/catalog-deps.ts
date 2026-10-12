import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

/**
 * Guard `catalog-deps`: every dependency of every `package.json` (root, packages, apps and
 * templates) comes from the pnpm catalog (`catalog:`) or from the workspace
 * (`workspace:*`). Versions live in one file, `pnpm-workspace.yaml`, and the guard on that
 * file makes them exact.
 */

export interface CatalogDepsInput {
  /** The `package.json` of the root and of every workspace package. */
  manifests: readonly TextFile[]
}

/** `catalog:` and a named catalog (`catalog:name`), or exactly `workspace:*`. */
export function isAllowedSpec(spec: unknown): boolean {
  return typeof spec === 'string' && (/^catalog:[\w.-]*$/.test(spec) || spec === 'workspace:*')
}

export function checkCatalogDeps(input: CatalogDepsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  for (const manifest of manifests) {
    for (const { field, name, spec } of dependencySpecs(manifest)) {
      if (isAllowedSpec(spec)) continue
      violations.push({
        rule: 'catalog-deps/inline-version',
        file: manifest.path,
        message: `${field}.${name} is ${JSON.stringify(spec)}: use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository`,
      })
    }
  }
  return violations
}
