import type { TextFile, Violation } from './types.ts'
import { dependencySpecs, parseManifests } from './workspace.ts'

export interface CatalogDepsInput {
  manifests: readonly TextFile[]
}

export function isAllowedSpec(spec: unknown): boolean {
  return typeof spec === 'string' && (/^catalog:[\w.-]*$/.test(spec) || spec === 'workspace:*')
}

export function isPeerRange(spec: unknown): boolean {
  return typeof spec === 'string' && /^\^\d+\.\d+\.\d+$/.test(spec)
}

export function checkCatalogDeps(input: CatalogDepsInput): Violation[] {
  const { manifests, violations } = parseManifests(input.manifests)
  for (const manifest of manifests) {
    const devFromCatalog = new Set(
      dependencySpecs(manifest, ['devDependencies'])
        .filter(({ spec }) => typeof spec === 'string' && spec.startsWith('catalog:'))
        .map(({ name }) => name),
    )
    for (const { field, name, spec } of dependencySpecs(manifest)) {
      if (isAllowedSpec(spec)) continue
      if (field === 'peerDependencies' && isPeerRange(spec)) {
        if (!devFromCatalog.has(name)) {
          violations.push({
            rule: 'catalog-deps/peer-without-dev',
            file: manifest.path,
            message: `peerDependencies.${name} is the range ${JSON.stringify(spec)}: list ${name} in devDependencies as "catalog:" too, so this repository builds and tests one exact version`,
          })
        }
        continue
      }
      violations.push({
        rule: 'catalog-deps/inline-version',
        file: manifest.path,
        message: `${field}.${name} is ${JSON.stringify(spec)}: use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository${field === 'peerDependencies' ? '; a peer dependency may also be a caret range such as "^4.2.0"' : ''}`,
      })
    }
  }
  return violations
}
