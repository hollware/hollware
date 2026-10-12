import { describe, expect, it } from 'vite-plus/test'
import { checkCatalogDeps, isAllowedSpec } from '../guards/catalog-deps.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: a dependency in any package.json (dependencies, devDependencies,
// peerDependencies, optionalDependencies) is anything but `catalog:` or `workspace:*`, except a
// caret range in peerDependencies whose package is also a devDependency from the catalog.

describe('catalog dependencies', () => {
  it('every dependency of every package.json comes from the catalog or the workspace', () => {
    const manifests = workspaceManifests()
    expect(manifests.length).toBeGreaterThanOrEqual(9)
    expect(describeViolations(checkCatalogDeps({ manifests }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (manifest: Record<string, unknown>) =>
      checkCatalogDeps({ manifests: [file('packages/core/package.json', json(manifest))] })

    it('accepts catalog: and workspace:*', () => {
      expect(
        check({
          dependencies: { '@hollware/server': 'workspace:*' },
          devDependencies: { typescript: 'catalog:' },
          peerDependencies: { vite: 'catalog:' },
        }),
      ).toEqual([])
    })

    it('reports an inline version, naming the field and the dependency', () => {
      expect(check({ devDependencies: { 'left-pad': '^1.0.0' } })).toEqual([
        {
          rule: 'catalog-deps/inline-version',
          file: 'packages/core/package.json',
          message:
            'devDependencies.left-pad is "^1.0.0": use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository',
        },
      ])
    })

    it('reports every kind of spec that is not the catalog or the workspace', () => {
      const specs = [
        '1.2.3',
        '~1.2.3',
        '*',
        'latest',
        'npm:other@1',
        'link:../x',
        'file:../x',
        'workspace:^',
        'git+https://example.com/x.git',
      ]
      const result = check({
        dependencies: Object.fromEntries(specs.map((spec, index) => [`dep${index}`, spec])),
      })
      expect(result).toHaveLength(specs.length)
    })

    it('looks at all four dependency fields', () => {
      const result = check({
        dependencies: { a: '1.0.0' },
        devDependencies: { b: '1.0.0' },
        peerDependencies: { c: '1.0.0' },
        optionalDependencies: { d: '1.0.0' },
      })
      expect(result.map((violation) => violation.message.split(' ')[0])).toEqual([
        'dependencies.a',
        'devDependencies.b',
        'peerDependencies.c',
        'optionalDependencies.d',
      ])
    })

    it('accepts a caret range in peerDependencies when the catalog provides the dev dependency', () => {
      expect(
        check({
          peerDependencies: { zod: '^4.2.0' },
          devDependencies: { zod: 'catalog:' },
        }),
      ).toEqual([])
    })

    it('reports a peer range without the dev dependency from the catalog', () => {
      expect(check({ peerDependencies: { zod: '^4.2.0' } })).toEqual([
        {
          rule: 'catalog-deps/peer-without-dev',
          file: 'packages/core/package.json',
          message:
            'peerDependencies.zod is the range "^4.2.0": list zod in devDependencies as "catalog:" too, so this repository builds and tests one exact version',
        },
      ])
      expect(
        check({ peerDependencies: { zod: '^4.2.0' }, devDependencies: { zod: 'workspace:*' } }),
      ).toHaveLength(1)
    })

    it('reports a peer that is not a caret range on a full version', () => {
      const result = check({
        peerDependencies: { a: '*', b: '>=4', c: '4.2.0', d: '^4' },
        devDependencies: { a: 'catalog:', b: 'catalog:', c: 'catalog:', d: 'catalog:' },
      })
      expect(result.map((violation) => violation.message)).toEqual([
        'peerDependencies.a is "*": use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository; a peer dependency may also be a caret range such as "^4.2.0"',
        'peerDependencies.b is ">=4": use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository; a peer dependency may also be a caret range such as "^4.2.0"',
        'peerDependencies.c is "4.2.0": use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository; a peer dependency may also be a caret range such as "^4.2.0"',
        'peerDependencies.d is "^4": use "catalog:" and pin the version in pnpm-workspace.yaml, or "workspace:*" for a package of this repository; a peer dependency may also be a caret range such as "^4.2.0"',
      ])
    })

    it('reports a dependency spec that is not a string', () => {
      expect(check({ dependencies: { a: 1 } })).toHaveLength(1)
      expect(isAllowedSpec(undefined)).toBe(false)
    })

    it('reports a manifest that is not valid JSON', () => {
      const result = checkCatalogDeps({ manifests: [file('apps/x/package.json', '{')] })
      expect(result.map((violation) => violation.rule)).toEqual(['manifest/invalid-json'])
    })
  })
})
