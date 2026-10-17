import { describe, expect, it } from 'vite-plus/test'
import { checkDeclaredImports, isScannedSource, packageOf } from '../guards/declared-imports.ts'
import { exceptionValues, VIRTUAL_IMPORTS } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: a .ts or .js file anywhere in the repository imports a package that the
// package.json of its own package (the root one for scripts/, tests/ and vite.config.ts)
// does not list in dependencies, devDependencies or peerDependencies, or imports a module no
// package has (`virtual:x`) that VIRTUAL_IMPORTS does not allow for that file; or an entry of
// VIRTUAL_IMPORTS is imported by no file.

describe('declared imports', () => {
  it('every bare import of the repository is declared by the package that makes it', () => {
    const sources = readRepoFiles(isScannedSource)
    // The scan must really see the code: these files cover a package, a root script, a root
    // config and a Worker app.
    expect(sources.map((source) => source.path)).toEqual(
      expect.arrayContaining([
        'packages/core/src/index.ts',
        'scripts/break-line.ts',
        'vite.config.ts',
        'apps/playground/test/workerd/database.workerd.test.ts',
      ]),
    )
    const violations = checkDeclaredImports({
      manifests: workspaceManifests(),
      sources,
      allowedVirtualImports: exceptionValues(VIRTUAL_IMPORTS),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const manifests = [
      file(
        'package.json',
        json({ name: 'root', devDependencies: { yaml: 'catalog:', 'vite-plus': 'catalog:' } }),
      ),
      file(
        'packages/core/package.json',
        json({
          name: '@hollware/core',
          dependencies: { zod: 'catalog:' },
          devDependencies: { 'vite-plus': 'catalog:' },
          peerDependencies: { '@scope/peer': 'catalog:' },
        }),
      ),
      file(
        'apps/playground/package.json',
        json({ name: 'playground', dependencies: { hono: 'catalog:' } }),
      ),
    ]
    const check = (path: string, text: string) =>
      checkDeclaredImports({ manifests, sources: [file(path, text)] })

    it('accepts declared packages, subpaths, relative paths and the built-in schemes', () => {
      const text = [
        "import { z } from 'zod/v4'",
        "import { it } from 'vite-plus/test'",
        "import peer from '@scope/peer/sub/path'",
        "import { name } from '@hollware/core'",
        "import { x } from './x.ts'",
        "import { y } from '../y.ts'",
        "import { readFileSync } from 'node:fs'",
        "import { env } from 'cloudflare:workers'",
        "export * from '.'",
      ].join('\n')
      expect(check('packages/core/tests/a.test.ts', text)).toEqual([])
    })

    it('does not mistake import-like text in strings, comments and templates for an import', () => {
      const text = [
        "// import leftPad from 'left-pad'",
        "/* export * from 'left-pad' */",
        'export const a = "import x from \'left-pad\'"',
        "export const b = `import y from 'left-pad' ${1}`",
        "export const c = /from 'left-pad'/",
      ].join('\n')
      expect(check('packages/core/src/a.ts', text)).toEqual([])
    })

    it('reports a package that only the root declares (the failure the guard exists for)', () => {
      expect(check('packages/core/src/index.ts', "import { parse } from 'yaml'\n")).toEqual([
        {
          rule: 'declared-imports/undeclared',
          file: 'packages/core/src/index.ts',
          message:
            'line 1 imports "yaml" (package yaml), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
        },
      ])
    })

    it('reports every import form and normalizes subpaths', () => {
      const text = [
        "import type { A } from 'left-pad/types'",
        "export { b } from '@scope/other/deep/file.js'",
        "const c = await import('dynamic-pkg')",
        "type D = typeof import('typed-pkg')",
        "const e = require('required-pkg')",
      ].join('\n')
      expect(
        check('packages/core/src/index.ts', text).map((violation) => violation.message),
      ).toEqual([
        'line 1 imports "left-pad/types" (package left-pad), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
        'line 2 imports "@scope/other/deep/file.js" (package @scope/other), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
        'line 3 imports "dynamic-pkg" (package dynamic-pkg), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
        'line 4 imports "typed-pkg" (package typed-pkg), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
        'line 5 imports "required-pkg" (package required-pkg), which packages/core/package.json does not declare: add it to dependencies, devDependencies or peerDependencies',
      ])
    })

    it('judges a file by the closest package, and root files by the root manifest', () => {
      // hono is declared by apps/playground, not by the root or by core.
      expect(check('apps/playground/site/src/index.ts', "import { Hono } from 'hono'\n")).toEqual(
        [],
      )
      expect(check('packages/core/src/index.ts', "import { Hono } from 'hono'\n")).toHaveLength(1)
      expect(check('tests/guards/a.ts', "import { parse } from 'yaml'\n")).toEqual([])
      expect(check('scripts/a.ts', "import { Hono } from 'hono'\n")).toHaveLength(1)
      expect(check('vite.config.ts', "import { defineConfig } from 'vite-plus'\n")).toEqual([])
    })

    it('reports a Node built-in imported without its node: prefix', () => {
      expect(check('packages/core/src/index.ts', "import { join } from 'path/posix'\n")).toEqual([
        {
          rule: 'declared-imports/undeclared',
          file: 'packages/core/src/index.ts',
          message:
            'line 1 imports the Node built-in "path/posix" by its bare name: write "node:path/posix"',
        },
      ])
    })

    it('reports specifiers that no consumer can resolve', () => {
      const text = [
        "import a from '#internal/a'",
        "import b from '~/b'",
        "import c from '@/c'",
        "import d from 'https://example.com/d.js'",
        "import e from 'virtual:e'",
      ].join('\n')
      const result = check('packages/core/src/index.ts', text)
      expect(result.map((violation) => violation.rule)).toEqual(
        Array.from({ length: 5 }, () => 'declared-imports/unsupported'),
      )
      expect(result[0]?.message).toBe(
        'line 1 imports "#internal/a", which is not a package name or a relative path: a consumer cannot resolve it',
      )
    })

    it('allows a virtual import for the file that VIRTUAL_IMPORTS names, and for no other', () => {
      const allowed = ['packages/core/src/a.ts#virtual:e']
      const text = "import e from 'virtual:e'\n"
      const run = (path: string) =>
        checkDeclaredImports({
          manifests,
          sources: [file(path, text)],
          allowedVirtualImports: allowed,
        }).map((violation) => violation.rule)

      expect(run('packages/core/src/a.ts')).toEqual([])
      expect(run('packages/core/src/b.ts')).toEqual([
        'declared-imports/unsupported',
        'declared-imports/unused-exception',
      ])
    })

    it('reports an allowed virtual import that no file makes', () => {
      expect(
        checkDeclaredImports({
          manifests,
          sources: [file('packages/core/src/a.ts', 'export {}\n')],
          allowedVirtualImports: ['packages/core/src/a.ts#virtual:e'],
        }),
      ).toEqual([
        {
          rule: 'declared-imports/unused-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'the allowed virtual import `packages/core/src/a.ts#virtual:e` is no longer needed (no such import): remove it from VIRTUAL_IMPORTS and lower its max',
        },
      ])
    })

    it('reports a file that does not parse', () => {
      const result = check('packages/core/src/index.ts', 'import {')
      expect(result[0]?.rule).toBe('declared-imports/syntax-error')
    })

    it('scans source files and skips what a tool generates', () => {
      expect(isScannedSource('packages/core/src/index.ts')).toBe(true)
      expect(isScannedSource('vite.config.ts')).toBe(true)
      expect(isScannedSource('apps/playground/test/workerd/env.d.ts')).toBe(true)
      expect(isScannedSource('scripts/tool.mjs')).toBe(true)
      expect(isScannedSource('apps/playground/worker-configuration.d.ts')).toBe(false)
      expect(isScannedSource('README.md')).toBe(false)
    })

    it('names the package of a specifier', () => {
      expect(packageOf('vite-plus/test')).toBe('vite-plus')
      expect(packageOf('@cloudflare/vitest-plugin/types')).toBe('@cloudflare/vitest-plugin')
      expect(packageOf('wrangler')).toBe('wrangler')
      expect(packageOf('@/alias')).toBeUndefined()
      expect(packageOf('#alias')).toBeUndefined()
    })
  })
})
